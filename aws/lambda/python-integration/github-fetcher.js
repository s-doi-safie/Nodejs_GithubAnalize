const fetch = require('node-fetch');

/**
 * GitHub API連携クラス
 * Pythonのfetch_pr_data.pyの機能をNode.jsに移植
 */
class GitHubFetcher {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'https://api.github.com';
        this.headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'GitHub-Analyzer-Lambda'
        };
        
        // レート制限対応
        this.rateLimitRemaining = 5000;
        this.rateLimitReset = Date.now();
        this.requestDelay = 100; // ms
    }

    /**
     * GitHub APIリクエストを実行
     */
    async makeRequest(url, options = {}) {
        // レート制限チェック
        if (this.rateLimitRemaining < 10) {
            const waitTime = this.rateLimitReset - Date.now();
            if (waitTime > 0) {
                console.log(`Rate limit approaching, waiting ${waitTime}ms`);
                await this.sleep(waitTime);
            }
        }

        const response = await fetch(url, {
            ...options,
            headers: {
                ...this.headers,
                ...options.headers
            }
        });

        // レート制限情報を更新
        this.rateLimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining') || '5000');
        this.rateLimitReset = parseInt(response.headers.get('x-ratelimit-reset') || '0') * 1000;

        if (!response.ok) {
            console.error(`GitHub API error: ${response.status} ${response.statusText}`);
            throw new Error(`GitHub API error: ${response.status}`);
        }

        // リクエスト間隔を制御
        await this.sleep(this.requestDelay);

        return response.json();
    }

    /**
     * 指定時間待機
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Pull Request データを取得
     */
    async fetchPRData(fromDate, toDate, teams = [], users = []) {
        console.log('Starting PR data fetch...');
        console.log(`Date range: ${fromDate} to ${toDate}`);
        console.log(`Teams: ${JSON.stringify(teams)}`);
        console.log(`Users: ${JSON.stringify(users)}`);

        const result = {
            period: [fromDate, toDate],
            data: {},
            pr_details: [],
            teams: teams,
            users: users,
            fetched_at: new Date().toISOString()
        };

        try {
            // 組織のリポジトリを取得（実際の組織名に置き換え必要）
            const repos = await this.getOrganizationRepos('your-org'); // 実際の組織名に変更
            
            const allPRs = [];
            
            // 各リポジトリからPRを取得
            for (const repo of repos) {
                console.log(`Fetching PRs from ${repo.full_name}...`);
                const prs = await this.getRepositoryPRs(repo.full_name, fromDate, toDate);
                allPRs.push(...prs);
            }

            console.log(`Total PRs found: ${allPRs.length}`);

            // フィルタリング（チーム・ユーザー指定がある場合）
            const filteredPRs = this.filterPRs(allPRs, teams, users);
            console.log(`Filtered PRs: ${filteredPRs.length}`);

            // PR詳細情報を取得
            const prDetails = await this.enrichPRDetails(filteredPRs);

            // データを集計・整理
            const processedData = this.processData(prDetails);

            result.data = processedData.data;
            result.pr_details = processedData.pr_details;

            console.log('PR data fetch completed successfully');
            return result;

        } catch (error) {
            console.error('Error fetching PR data:', error);
            throw error;
        }
    }

    /**
     * 組織のリポジトリ一覧を取得
     */
    async getOrganizationRepos(org) {
        const repos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `${this.baseUrl}/orgs/${org}/repos?page=${page}&per_page=100&type=all`;
            const data = await this.makeRequest(url);
            
            repos.push(...data);
            
            if (data.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        return repos;
    }

    /**
     * 指定リポジトリのPR一覧を取得
     */
    async getRepositoryPRs(repoFullName, fromDate, toDate) {
        const prs = [];
        let page = 1;
        let hasMore = true;

        const fromDateTime = new Date(fromDate);
        const toDateTime = new Date(toDate);

        while (hasMore) {
            const url = `${this.baseUrl}/repos/${repoFullName}/pulls?state=all&page=${page}&per_page=100&sort=updated&direction=desc`;
            const data = await this.makeRequest(url);
            
            for (const pr of data) {
                const createdAt = new Date(pr.created_at);
                
                // 作成日時が範囲外の場合はスキップ
                if (createdAt < fromDateTime) {
                    hasMore = false;
                    break;
                }
                
                if (createdAt <= toDateTime) {
                    prs.push({
                        ...pr,
                        repository: repoFullName
                    });
                }
            }
            
            if (data.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        return prs;
    }

    /**
     * PRをフィルタリング
     */
    filterPRs(prs, teams, users) {
        if (teams.length === 0 && users.length === 0) {
            return prs;
        }

        return prs.filter(pr => {
            const author = pr.user.login;
            
            // ユーザー指定がある場合
            if (users.length > 0 && users.includes(author)) {
                return true;
            }
            
            // チーム指定がある場合（実際のチーム管理ロジックに応じて調整）
            if (teams.length > 0) {
                // ここでは簡易的な実装。実際はチームメンバー情報が必要
                return teams.some(team => author.includes(team.toLowerCase()));
            }
            
            return false;
        });
    }

    /**
     * PR詳細情報を付加
     */
    async enrichPRDetails(prs) {
        const enrichedPRs = [];
        
        for (let i = 0; i < prs.length; i++) {
            const pr = prs[i];
            console.log(`Processing PR ${i + 1}/${prs.length}: ${pr.title}`);
            
            try {
                // レビュー情報を取得
                const reviews = await this.getPRReviews(pr.repository, pr.number);
                
                // コメント情報を取得
                const comments = await this.getPRComments(pr.repository, pr.number);
                
                // 詳細情報を付加
                const enrichedPR = {
                    ...pr,
                    reviews: reviews,
                    comments: comments,
                    num_comments: comments.length,
                    first_review: this.getFirstReviewTime(reviews),
                    lifetime_days: this.calculateLifetimeDays(pr.created_at, pr.closed_at),
                    status: pr.merged_at ? 'merged' : (pr.closed_at ? 'closed' : 'open')
                };
                
                enrichedPRs.push(enrichedPR);
                
            } catch (error) {
                console.error(`Error enriching PR ${pr.number}:`, error);
                // エラーが発生した場合も基本情報は保持
                enrichedPRs.push(pr);
            }
        }
        
        return enrichedPRs;
    }

    /**
     * PRのレビュー情報を取得
     */
    async getPRReviews(repo, prNumber) {
        const url = `${this.baseUrl}/repos/${repo}/pulls/${prNumber}/reviews`;
        return await this.makeRequest(url);
    }

    /**
     * PRのコメント情報を取得
     */
    async getPRComments(repo, prNumber) {
        const url = `${this.baseUrl}/repos/${repo}/pulls/${prNumber}/comments`;
        return await this.makeRequest(url);
    }

    /**
     * 最初のレビュー時刻を取得
     */
    getFirstReviewTime(reviews) {
        if (!reviews || reviews.length === 0) {
            return null;
        }
        
        const reviewTimes = reviews
            .filter(review => review.state !== 'COMMENTED' || review.body)
            .map(review => new Date(review.submitted_at))
            .sort((a, b) => a - b);
            
        return reviewTimes.length > 0 ? reviewTimes[0].toISOString() : null;
    }

    /**
     * PRのライフタイムを計算（日数）
     */
    calculateLifetimeDays(createdAt, closedAt) {
        const created = new Date(createdAt);
        const closed = closedAt ? new Date(closedAt) : new Date();
        const diffTime = Math.abs(closed - created);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * データを処理・集計
     */
    processData(prs) {
        const data = {};
        const prDetails = [];

        // 作成者別にグループ化
        const authorGroups = {};
        
        prs.forEach(pr => {
            const author = pr.user.login;
            
            if (!authorGroups[author]) {
                authorGroups[author] = {
                    name: author,
                    avatar_url: pr.user.avatar_url,
                    created: [],
                    reviewed: []
                };
            }
            
            authorGroups[author].created.push(pr);
            
            // PR詳細データを追加
            prDetails.push({
                id: pr.id,
                number: pr.number,
                title: pr.title,
                author: author,
                repository: pr.repository,
                created_at: pr.created_at,
                closed_at: pr.closed_at,
                merged_at: pr.merged_at,
                first_review: pr.first_review,
                lifetime_days: pr.lifetime_days,
                num_comments: pr.num_comments,
                status: pr.status,
                html_url: pr.html_url,
                assignees: pr.assignees?.map(a => a.login) || [],
                requested_reviewers: pr.requested_reviewers?.map(r => r.login) || []
            });
        });

        // レビュー情報を追加
        prs.forEach(pr => {
            if (pr.reviews) {
                pr.reviews.forEach(review => {
                    const reviewer = review.user.login;
                    if (authorGroups[reviewer]) {
                        authorGroups[reviewer].reviewed.push({
                            pr_id: pr.id,
                            pr_number: pr.number,
                            pr_title: pr.title,
                            review_state: review.state,
                            submitted_at: review.submitted_at
                        });
                    }
                });
            }
        });

        // データ構造を整理
        Object.values(authorGroups).forEach(author => {
            data[author.name] = {
                created_count: author.created.length,
                reviewed_count: author.reviewed.length,
                avatar_url: author.avatar_url,
                created_prs: author.created.map(pr => ({
                    id: pr.id,
                    number: pr.number,
                    title: pr.title,
                    repository: pr.repository
                })),
                reviewed_prs: author.reviewed
            };
        });

        return { data, pr_details: prDetails };
    }

    /**
     * チーム情報を更新
     */
    async updateTeamInfo() {
        try {
            console.log('Updating team information...');
            
            // 組織のメンバーを取得
            const members = await this.getOrganizationMembers('your-org'); // 実際の組織名に変更
            
            // チーム一覧を取得
            const teams = await this.getOrganizationTeams('your-org'); // 実際の組織名に変更
            
            const teamData = {};
            
            // 各チームのメンバーを取得
            for (const team of teams) {
                const teamMembers = await this.getTeamMembers('your-org', team.slug);
                teamData[team.name] = {
                    id: team.id,
                    slug: team.slug,
                    description: team.description,
                    members: teamMembers.map(member => ({
                        login: member.login,
                        name: member.name || member.login,
                        avatar_url: member.avatar_url
                    }))
                };
            }
            
            console.log('Team information updated successfully');
            return teamData;
            
        } catch (error) {
            console.error('Error updating team information:', error);
            throw error;
        }
    }

    /**
     * 組織のメンバー一覧を取得
     */
    async getOrganizationMembers(org) {
        const members = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `${this.baseUrl}/orgs/${org}/members?page=${page}&per_page=100`;
            const data = await this.makeRequest(url);
            
            members.push(...data);
            
            if (data.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        return members;
    }

    /**
     * 組織のチーム一覧を取得
     */
    async getOrganizationTeams(org) {
        const teams = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `${this.baseUrl}/orgs/${org}/teams?page=${page}&per_page=100`;
            const data = await this.makeRequest(url);
            
            teams.push(...data);
            
            if (data.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        return teams;
    }

    /**
     * チームのメンバー一覧を取得
     */
    async getTeamMembers(org, teamSlug) {
        const members = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `${this.baseUrl}/orgs/${org}/teams/${teamSlug}/members?page=${page}&per_page=100`;
            const data = await this.makeRequest(url);
            
            members.push(...data);
            
            if (data.length < 100) {
                hasMore = false;
            } else {
                page++;
            }
        }

        return members;
    }
}

module.exports = GitHubFetcher;