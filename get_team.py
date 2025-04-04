import json
import config as cfg
from github import Github
# import argparse

def get_teams_and_members(org_name, output_file, token=None):
    """
    指定された組織のすべてのチームとメンバーを取得し、JSON形式でファイルに出力する
    
    Args:
        org_name (str): GitHub 組織名
        output_file (str): 出力ファイルのパス
        token (str, optional): GitHub アクセストークン。環境変数からも取得可能
    """
    # トークンの取得 (引数 > 環境変数)
    if not token:
        token = cfg.github_token
    
    if not token:
        raise ValueError("GitHub トークンが必要です。引数で指定するか、GITHUB_TOKEN 環境変数を設定してください。")
    
    # GitHub クライアントの初期化
    g = Github(token)
    
    try:
        # 組織の取得
        org = g.get_organization(org_name)
        
        # チームとメンバーの情報を格納する辞書
        teams_data = {}
        
        # すべてのチームを取得
        teams = org.get_teams()
        print(f"組織 '{org_name}' のチーム情報を取得中...")
        
        for team in teams:
            team_name = team.name
            print(f"チーム '{team_name}' のメンバーを取得中...")
            
            # チームメンバーの取得
            members = team.get_members()
            member_list = [member.login for member in members]
            
            # 結果を辞書に追加
            teams_data[team_name] = member_list
        
        # JSON ファイルとして出力
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(teams_data, f, ensure_ascii=False, indent=4)
        
        print(f"完了しました。結果は {output_file} に保存されました。")
        
    except Exception as e:
        print(f"エラーが発生しました: {str(e)}")

if __name__ == "__main__":
    # parser = argparse.ArgumentParser(description='GitHub 組織のチームとメンバーを取得する')
    # parser.add_argument('org_name', help='GitHub 組織名')
    # parser.add_argument('--output', '-o', default='teams_members.json', help='出力ファイル名 (デフォルト: teams_members.json)')
    # parser.add_argument('--token', '-t', help='GitHub アクセストークン (環境変数 GITHUB_TOKEN からも取得可能)')
    
    # args = parser.parse_args()
    
    get_teams_and_members("SafieDev", "teams.json")