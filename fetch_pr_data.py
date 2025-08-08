import sys
import json
import os
import re
import dataclasses
import time
import concurrent.futures
from datetime import datetime, timedelta, timezone
from typing import Generator, Dict, List, Any, Optional, Tuple
from zoneinfo import ZoneInfo

import config as cfg
import numpy as np  # 40 ms
import requests
# from holiday_jp import HolidayJp
from tqdm import tqdm


@dataclasses.dataclass
class PullRequest:
    title: str
    created: datetime
    first_review: datetime | None
    closed: datetime | None
    is_merged: bool
    num_comments: int

    @staticmethod
    def daterange(start: datetime, end: datetime) -> Generator[datetime, None, None]:
        current = start
        while current <= end:
            yield current
            current += timedelta(days=1)

    def is_closed(self) -> bool:
        return self.closed is not None

    def elapsed(self) -> timedelta:
        if self.closed is None:
            return datetime.now().astimezone(ZoneInfo("Asia/Tokyo")) - self.created
        return self.closed - self.created

    def elapsed_business_days(self) -> timedelta:
        if self.closed is None:
            end_dt = datetime.now().astimezone(ZoneInfo("Asia/Tokyo"))
        else:
            end_dt = self.closed

        # for dt in self.daterange(self.created, end_dt):
        #     if not HolidayJp(dt.date()).is_business_day:
        #         end_dt -= timedelta(days=1)
        return end_dt - self.created

    def first_review_elapsed_business_days(self) -> timedelta:
        if self.first_review is None:
            end_dt = datetime.now().astimezone(ZoneInfo("Asia/Tokyo"))
        else:
            end_dt = self.first_review

        # for dt in self.daterange(self.created, end_dt):
        #     if not HolidayJp(dt.date()).is_business_day:
        #         end_dt -= timedelta(days=1)
        return end_dt - self.created


def validate_date(date_string: str) -> None:
    pattern = r"^\d{4}-\d{2}-\d{2}$"
    if not re.match(pattern, date_string):
        print("date format must be yyyy-mm-dd")
        sys.exit(1)


def validate_period(from_date: str, to_date: str) -> None:
    if from_date > to_date:
        print("from_date must be earlier than to_date")
        sys.exit(1)


def convert_to_jst(time_str: str | None) -> datetime | None:
    if time_str is None:
        return None
    time_dt = datetime.strptime(time_str.replace("Z", ""), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    return time_dt.astimezone(ZoneInfo("Asia/Tokyo"))


def fetch_page(url: str, headers: Dict[str, str], page: int) -> Dict[str, Any]:
    """1ページ分のデータを取得する関数（並列処理用）"""
    paginated_url = f"{url}&page={page}"
    response = requests.get(paginated_url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error fetching page {page}: {response.status_code}")
        print(f"message: {response.json()['message']}")
        print(f"documentation_url: {response.json()['documentation_url']}")
        return {"items": [], "error": True, "status_code": response.status_code}
    
    return response.json()


def search_pr_by_authors(usernames: list[str], from_date: str, to_date: str, token: str) -> dict:
    headers = {
        "Accept": "application/vnd.github.text-match+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    usernames = usernames.copy()
    usernames.insert(0, "")  # Insert empty string to add prefix for the first element

    query_webapp = "type:pr org:SafieDev"
    query_webapp += " author:".join(usernames)
    query_webapp += f" created:{from_date}..{to_date}"
    print("Search query for webapp: ")
    print(query_webapp)

    query_rest = "type:pr+org:SafieDev"
    query_rest += "+author:".join(usernames)
    query_rest += f"+created:{from_date}..{to_date}&sort=created&order=desc&per_page=100"
    
    base_url = f"https://api.github.com/search/issues?q={query_rest}"
    
    # 最初のページを取得して総数を確認
    print("Fetching first page to determine total count...")
    first_page = fetch_page(base_url, headers, 1)
    
    if "error" in first_page and first_page["error"]:
        print(f"Error fetching first page: {first_page.get('status_code')}")
        sys.exit(1)
    
    total_count = first_page["total_count"]
    print(f"Total PRs to fetch: {total_count}")
    
    # 必要なページ数を計算
    pages_needed = (total_count + 99) // 100  # 切り上げ除算
    print(f"Pages needed: {pages_needed}")
    
    # 最初のページは既に取得済み
    all_items = first_page["items"]
    
    # 2ページ目以降を並列で取得
    if pages_needed > 1:
        if pages_needed > 10:
            pages_needed = 10  # 最大10ページまで並列で取得
        print(f"Fetching remaining {pages_needed - 1} pages in parallel...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, pages_needed - 1)) as executor:
            # 2ページ目から並列で取得
            future_to_page = {
                executor.submit(fetch_page, base_url, headers, page): page
                for page in range(2, pages_needed + 1)
            }
            
            for future in tqdm(concurrent.futures.as_completed(future_to_page), total=len(future_to_page)):
                page = future_to_page[future]
                try:
                    data = future.result()
                    if "error" in data and data["error"]:
                        print(f"Error fetching page {page}: {data.get('status_code')}")
                        continue
                    all_items.extend(data["items"])
                except Exception as exc:
                    print(f"Page {page} generated an exception: {exc}")
    
    # 結果を構築
    result = first_page.copy()
    result["items"] = all_items
    
    print(f"Total PRs fetched: {len(all_items)} / {total_count}")
    
    if len(all_items) < total_count:
        print(f"Warning: Could only fetch {len(all_items)} PRs out of {total_count} total PRs.")
    
    if False:  # for debug
        search_cache = f"search_result_{from_date}_{to_date}.json"
        json.dump(result, open(search_cache, "w"), indent=2)

    return result


def check_pr_update(item: dict, search_api_cache: dict) -> bool:
    url = item["html_url"]
    if url in search_api_cache:
        updated_at = search_api_cache[url]
        if item["updated_at"] == updated_at:
            return False
    return True


def fetch_api_data(url: str, token: str) -> Dict[str, Any]:
    """APIからデータを取得する関数（並列処理用）"""
    headers = {
        "Accept": "application/vnd.github.text-match+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(f"Error fetching {url}: {response.status_code}")
        return {"error": True, "status_code": response.status_code}
    
    return response.json()


def get_requested_reviewers(
    owner: str,
    repository: str,
    pr_number: int,
    token: str,
    pulls_api_cache: dict,
    refresh: bool,
) -> list[str]:
    # Use GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers

    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}/requested_reviewers"

    if url not in pulls_api_cache or refresh:
        headers = {
            "Accept": "application/vnd.github.text-match+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(response)
            sys.exit(1)
        response_json = response.json()
        pulls_api_cache[url] = response_json
    else:
        response_json = pulls_api_cache[url]

    reviewers = []
    for reviewer in response_json["users"]:
        reviewers.append(reviewer["login"])
    return reviewers


def refresh_reviews_api_cache(
    owner: str,
    repository: str,
    pr_number: int,
    token: str,
    pulls_api_cache: dict,
    refresh: bool,
) -> None:
    # Use GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews

    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}/reviews"

    if url not in pulls_api_cache or refresh:
        headers = {
            "Accept": "application/vnd.github.text-match+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            print(response)
            sys.exit(1)
        response_json = response.json()
        pulls_api_cache[url] = response_json


def get_completed(
    owner: str,
    repository: str,
    pr_number: int,
    author: str,
    requested: list[str],
    pulls_api_cache: dict,
) -> list[str]:
    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}/reviews"

    response_json = pulls_api_cache[url]

    reviewers = []
    for review in response_json:
        reviewers.append(review["user"]["login"])
    reviewers = list(set(reviewers))  # Remove duplicates

    if author in reviewers:  # Remove self comment
        reviewers.remove(author)

    for reviewer in requested:
        if reviewer in reviewers:
            reviewers.remove(reviewer)  # Remove re-requested reviewer from reviewed reviewers

    return reviewers


def get_first_person_review(
    owner: str, repository: str, pr_number: int, author: str, pulls_api_cache: dict
) -> datetime | None:
    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}/reviews"

    response_json = pulls_api_cache[url]

    for review in response_json:
        if review["user"]["login"] == author:
            continue
        elif review["user"]["login"] == "copilot-pull-request-reviewer[bot]":
            continue
        return convert_to_jst(review["submitted_at"])

    return None


def refresh_cache(url: str, api_cache: dict, token: str) -> None:
    headers = {
        "Accept": "application/vnd.github.text-match+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        print(response)
        sys.exit(1)
    response_json = response.json()
    api_cache[url] = response_json


def refresh_pulls_api_cache(
    owner: str,
    repository: str,
    pr_number: int,
    pulls_api_cache: dict,
    token: str,
    refresh: bool,
) -> None:
    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}"
    if url not in pulls_api_cache or refresh:
        refresh_cache(url, pulls_api_cache, token)


def get_pull_request(owner: str, repository: str, pr_number: int, author: str, pulls_api_cache: dict) -> PullRequest:
    url = f"https://api.github.com/repos/{owner}/{repository}/pulls/{pr_number}"
    assert url in pulls_api_cache

    response_json = pulls_api_cache[url]
    title = response_json["title"]
    created = convert_to_jst(response_json["created_at"])
    assert created is not None
    closed = convert_to_jst(response_json["closed_at"])
    is_merged = response_json["merged"]
    num_comments = response_json["comments"] + response_json["review_comments"]
    return PullRequest(title, created, None, closed, is_merged, num_comments)


def update_matrix_data(
    data: np.ndarray,
    repo_name: str,
    pr_number: int,
    author: str,
    authors: list[str],
    requested: list[str],
    completed: list[str],
) -> None:
    author_index = authors.index(author)
    for reviewer in requested:
        try:
            reviewer_index = authors.index(reviewer)
        except ValueError:
            print(f"Review requested to other group member: {reviewer} in {repo_name} #{pr_number}")
            continue
        data[0][author_index][reviewer_index] += 1

    for reviewer in completed:
        try:
            reviewer_index = authors.index(reviewer)
        except ValueError:
            print(f"Reviewed by other group member: {reviewer} in {repo_name} #{pr_number}")
            continue
        data[1][author_index][reviewer_index] += 1


def get_github_data(
    authors,
    author_count,
    requested_count,
    completed_count,
    from_date,
    to_date,
    pr_details,
    team_name=None,
):
    authors = [author.replace("-safie", "") for author in authors]
    authors = [author.replace("-sf", "") for author in authors]
    result = {
        "period": [from_date, to_date],
        "labels": authors,
        "datasets": [
            {
                "label": "Author",
                "data": author_count,
            },
            {
                "label": "Review Requested",
                "data": requested_count.tolist(),
            },
            {
                "label": "Review Completed",
                "data": completed_count.tolist(),
            },
        ],
        "pr_details": pr_details,
    }
    
    # チーム名が指定されている場合は、結果に含める
    if team_name:
        result["team"] = team_name
        
    return result


def process_pr_item(item: Dict[str, Any], authors: List[str], token: str, 
                   search_api_cache: Dict[str, str], pulls_api_cache: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str], List[str]]:
    """PRアイテムを処理する関数（並列処理用）"""
    owner = item["repository_url"].split("/")[-2]
    repo_name = item["repository_url"].split("/")[-1]
    pr_number = item["number"]
    author = item["user"]["login"]
    
    # キャッシュの更新が必要かチェック
    refresh = check_pr_update(item, search_api_cache)
    
    # キャッシュの更新
    reviews_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/reviews"
    pulls_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}"
    requested_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/requested_reviewers"
    
    # 必要なAPIデータを並列で取得
    urls_to_fetch = []
    if refresh:
        if reviews_url not in pulls_api_cache:
            urls_to_fetch.append(reviews_url)
        if pulls_url not in pulls_api_cache:
            urls_to_fetch.append(pulls_url)
        if requested_url not in pulls_api_cache:
            urls_to_fetch.append(requested_url)
    
    # 並列でAPIデータを取得
    if urls_to_fetch:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(urls_to_fetch)) as executor:
            future_to_url = {executor.submit(fetch_api_data, url, token): url for url in urls_to_fetch}
            for future in concurrent.futures.as_completed(future_to_url):
                url = future_to_url[future]
                try:
                    data = future.result()
                    if "error" not in data:
                        pulls_api_cache[url] = data
                except Exception as exc:
                    print(f"URL {url} generated an exception: {exc}")
    
    # キャッシュを更新
    search_api_cache[item["html_url"]] = item["updated_at"]
    
    # レビュワー情報を取得
    requested = get_requested_reviewers(owner, repo_name, pr_number, token, pulls_api_cache, refresh)
    completed = get_completed(owner, repo_name, pr_number, author, requested, pulls_api_cache)
    
    # PR詳細情報を作成
    pull_request = get_pull_request(owner, repo_name, pr_number, author, pulls_api_cache)
    pull_request.first_review = get_first_person_review(owner, repo_name, pr_number, author, pulls_api_cache)
    
    title = item["title"]
    html_url = item["html_url"]
    status = item["state"]
    created_day = item["created_at"]
    closed_day = item["closed_at"]
    num_comments = pull_request.num_comments
    lifetime_day = pull_request.elapsed_business_days().days
    lifetime_hour = pull_request.elapsed_business_days().seconds // 3600
    first_review_hour = int(pull_request.first_review_elapsed_business_days().total_seconds() // 3600)
    first_review_min = int((pull_request.first_review_elapsed_business_days().total_seconds() % 3600) // 60)
    
    pr_detail = {
        "author": author,
        "title": title,
        "html_url": html_url,
        "status": status,
        "created_day": created_day,
        "closed_day": closed_day,
        "requested": requested,
        "completed": completed,
        "num_comments": num_comments,
        "lifetime_day": lifetime_day,
        "lifetime_hour": lifetime_hour,
        "first_review_hour": first_review_hour,
        "first_review_min": first_review_min,
    }
    
    return pr_detail, requested, completed


# Excute main
def main():
    from_date = ""
    to_date = ""
    teams_list = []
    users_list = []
    
    if len(sys.argv) > 1:
        from_date = sys.argv[1]
        to_date = sys.argv[2]
        
        # フィルターパラメータが指定されている場合はJSONとして解析
        if len(sys.argv) > 3:
            filter_param_str = sys.argv[3]
            print(f"受け取ったパラメータ: {filter_param_str}")
            
            # 単一のチーム名かJSONかを判断
            if filter_param_str.startswith('{'):
                try:
                    # シングルクォートをダブルクォートに置換してJSONとして解析
                    # 外側のシングルクォートを削除
                    if filter_param_str.startswith("'") and filter_param_str.endswith("'"):
                        filter_param_str = filter_param_str[1:-1]
                    
                    # 内部のシングルクォートをダブルクォートに置換
                    filter_param_str = filter_param_str.replace("'", '"')
                    print(f"JSON解析用文字列: {filter_param_str}")
                    
                    filter_params = json.loads(filter_param_str)
                    
                    # 辞書からチームとユーザーのリストを取得
                    if isinstance(filter_params, dict):
                        teams_list = filter_params.get("teams", [])
                        users_list = filter_params.get("users", [])
                    else:
                        print(f"予期しない形式のデータ: {filter_params}")
                        teams_list = []
                        users_list = []
                except json.JSONDecodeError as e:
                    print(f"JSONパースエラー: {e}")
                    print(f"解析に失敗した文字列: {filter_param_str}")
                    # 後方互換性のため、単一のチーム名として扱う
                    teams_list = []
                    users_list = []
            else:
                # 単一のチーム名として扱う
                teams_list = [filter_param_str]
                users_list = []
    try:
        datetime.strptime(from_date, "%Y-%m-%d")
        datetime.strptime(to_date, "%Y-%m-%d")
    except ValueError:
        print(json.dumps({"error": "Invalid date format"}))
        sys.exit(1)

    token = cfg.github_token
    # チーム設定
    with open("teams.json", "r", encoding="utf-8") as f:
        teams_data = json.load(f)

    # 著者リストの初期化
    authors = []
    team_names = []
    
    # 指定されたチームのメンバーを追加
    if teams_list:
        for team_name in teams_list:
            if team_name in teams_data:
                authors.extend(teams_data[team_name])
                team_names.append(team_name)
    # チームが指定されていない場合は全チームのメンバーを使用
    elif not users_list:  # ユーザーも指定されていない場合
        for team_members in teams_data.values():
            authors.extend(team_members)
        print(f"Using all authors: {len(set(authors))} members")
    
    # 指定されたユーザーを追加
    if users_list:
        authors.extend(users_list)
    
    # 重複を削除
    authors = list(set(authors))
    
    # チーム名の表示用（複数チームの場合は "Team1, Team2" のように表示）
    team_name = ", ".join(team_names) if team_names else None
    
    if team_name:
        print(f"Using teams: {team_name} with {len(authors)} members")
    elif users_list:
        print(f"Using specified users: {len(authors)} members")

    # Load search API cache
    search_api_cache_filename = "search_api_cache.json"
    if os.path.exists(search_api_cache_filename):
        with open(search_api_cache_filename, "r") as f:
            search_api_cache = json.load(f)
    else:
        search_api_cache = {}

    # Search pull requests
    start_time = time.time()
    pulls = search_pr_by_authors(authors, from_date, to_date, token)  # Rate limit: 10 times per minute
    num_pr_tot = pulls["total_count"]
    print(f"Log: # searched pull requests: {num_pr_tot}", file=sys.stderr)
    print(f"Search completed in {time.time() - start_time:.2f} seconds")

    # Load pulls API cache
    pulls_api_cache_filename = "pulls_api_cache.json"
    if os.path.exists(pulls_api_cache_filename):
        with open(pulls_api_cache_filename, "r") as f:
            pulls_api_cache = json.load(f)
    else:
        pulls_api_cache = {}

    # Calculate author-reviewer matrix
    print(f"Processing PR data for {num_pr_tot} pull requests...")
    n = len(authors)
    data = np.zeros((2, n, n), dtype=int)  # (requested/reviewed, author, reviewer)
    pull_requests: dict[str, list[PullRequest]] = {author: [] for author in authors}
    author_count = np.zeros(n, dtype=int)

    items = pulls["items"]
    num_items = len(items)
    pr_details = []
    
    # PRデータの処理
    start_time = time.time()
    
    # バッチサイズを設定（GitHubのAPIレート制限に配慮）
    batch_size = 10
    for i in tqdm(range(0, num_items, batch_size)):
        batch_items = items[i:min(i+batch_size, num_items)]
        
        for item in batch_items:
            # fetch した PR の情報を取得
            owner = item["repository_url"].split("/")[-2]
            repo_name = item["repository_url"].split("/")[-1]
            pr_number = item["number"]
            author = item["user"]["login"]
            title = item["title"]
            html_url = item["html_url"]
            status = item["state"]
            created_day = item["created_at"]
            closed_day = item["closed_at"]

            # Cash が古い場合は更新
            refresh = check_pr_update(item, search_api_cache)
            search_api_cache[item["html_url"]] = item["updated_at"]  # Update timestamp
            
            # 並列でAPIデータを更新
            reviews_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/reviews"
            pulls_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}"
            requested_url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls/{pr_number}/requested_reviewers"
            
            urls_to_fetch = []
            if refresh or reviews_url not in pulls_api_cache:
                urls_to_fetch.append(reviews_url)
            if refresh or pulls_url not in pulls_api_cache:
                urls_to_fetch.append(pulls_url)
            if refresh or requested_url not in pulls_api_cache:
                urls_to_fetch.append(requested_url)
            
            # 並列でAPIデータを取得
            if urls_to_fetch:
                with concurrent.futures.ThreadPoolExecutor(max_workers=len(urls_to_fetch)) as executor:
                    future_to_url = {executor.submit(fetch_api_data, url, token): url for url in urls_to_fetch}
                    for future in concurrent.futures.as_completed(future_to_url):
                        url = future_to_url[future]
                        try:
                            data_result = future.result()
                            if "error" not in data_result:
                                pulls_api_cache[url] = data_result
                            else:
                                print(f"Error fetching {url}: {data_result.get('status_code')}")
                        except Exception as exc:
                            print(f"URL {url} generated an exception: {exc}")

            # PR の情報を取得
            pull_request = get_pull_request(owner, repo_name, pr_number, author, pulls_api_cache)
            pull_request.first_review = get_first_person_review(owner, repo_name, pr_number, author, pulls_api_cache)
            pull_requests[author].append(pull_request)

            # Author-reviewer matrix
            requested = get_requested_reviewers(owner, repo_name, pr_number, token, pulls_api_cache, refresh)
            completed = get_completed(owner, repo_name, pr_number, author, requested, pulls_api_cache)
            update_matrix_data(data, repo_name, pr_number, author, authors, requested, completed)

            # PR の詳細情報を取得
            num_comments = pull_request.num_comments
            lifetime_day = pull_request.elapsed_business_days().days
            lifetime_hour = pull_request.elapsed_business_days().seconds // 3600
            first_review_hour = int(pull_request.first_review_elapsed_business_days().total_seconds() // 3600)
            first_review_min = int((pull_request.first_review_elapsed_business_days().total_seconds() % 3600) // 60)

            pr_detail = {
                "author": author,
                "title": title,
                "html_url": html_url,
                "status": status,
                "created_day": created_day,
                "closed_day": closed_day,
                "requested": requested,
                "completed": completed,
                "num_comments": num_comments,
                "lifetime_day": lifetime_day,
                "lifetime_hour": lifetime_hour,
                "first_review_hour": first_review_hour,
                "first_review_min": first_review_min,
            }
            pr_details.append(pr_detail)
    
    print(f"PR processing completed in {time.time() - start_time:.2f} seconds")
    
    # キャッシュを保存
    json.dump(pulls_api_cache, open(pulls_api_cache_filename, "w"), indent=2)
    json.dump(search_api_cache, open(search_api_cache_filename, "w"), indent=2)

    print("Author-reviewer matrix (review-requested, review-completed): ")
    author_count = [len(pull_requests[author]) for author in authors]
    requested_count = np.sum(data[0], axis=0)
    completed_count = np.sum(data[1], axis=0)
    for i in range(n):
        print(f"{authors[i]}: {author_count[i]}, {requested_count[i]}, {completed_count[i]}")

    data = get_github_data(
        authors,
        author_count,
        requested_count,
        completed_count,
        from_date,
        to_date,
        pr_details,
        team_name,
    )
    json.dump(data, open("github_data.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
