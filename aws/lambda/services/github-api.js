const GitHubFetcher = require('../python-integration/github-fetcher');
const DynamoDBService = require('./dynamodb');

/**
 * GitHub API統合サービス
 * GitHubFetcherとDynamoDBServiceを統合して、データの取得・保存を管理
 */
class GitHubApiService {
    constructor() {
        this.dynamoService = new DynamoDBService();
        
        // GitHub トークンを環境変数またはSSMから取得
        this.githubToken = process.env.GITHUB_TOKEN;
        
        if (!this.githubToken) {
            console.warn('GitHub token not found. GitHub API functionality will be limited.');
        }
        
        this.githubFetcher = new GitHubFetcher(this.githubToken);
    }

    /**
     * PRデータを取得・更新
     */
    async fetchAndUpdatePRData(fromDate, toDate, teams = [], users = []) {
        try {
            console.log('Starting PR data fetch and update...');
            
            if (!this.githubToken) {
                throw new Error('GitHub token is required for data fetching');
            }

            // GitHub APIからデータを取得
            const prData = await this.githubFetcher.fetchPRData(fromDate, toDate, teams, users);
            
            // DynamoDBに保存
            await this.dynamoService.savePRData(prData, [fromDate, toDate]);
            
            console.log('PR data fetch and update completed successfully');
            return {
                success: true,
                message: 'Successfully data updated',
                data: prData
            };

        } catch (error) {
            console.error('Error in fetchAndUpdatePRData:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 保存済みPRデータを取得
     */
    async getStoredPRData() {
        try {
            const prData = await this.dynamoService.getPRData();
            return prData;

        } catch (error) {
            console.error('Error getting stored PR data:', error);
            throw error;
        }
    }

    /**
     * チーム情報を更新
     */
    async updateTeamInfo() {
        try {
            console.log('Starting team info update...');
            
            if (!this.githubToken) {
                throw new Error('GitHub token is required for team info update');
            }

            // GitHub APIからチーム情報を取得
            const teamData = await this.githubFetcher.updateTeamInfo();
            
            // DynamoDBに保存
            await this.dynamoService.saveTeamData(teamData);
            
            console.log('Team info update completed successfully');
            return {
                success: true,
                message: 'チーム情報が正常に更新されました',
                data: teamData
            };

        } catch (error) {
            console.error('Error in updateTeamInfo:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * 保存済みチーム情報を取得
     */
    async getStoredTeamData() {
        try {
            const teamData = await this.dynamoService.getTeamData();
            return { teams: teamData };

        } catch (error) {
            console.error('Error getting stored team data:', error);
            throw error;
        }
    }

    /**
     * 特定チームの情報を取得
     */
    async getTeamInfo(teamName) {
        try {
            const teamInfo = await this.dynamoService.getTeamInfo(teamName);
            return teamInfo;

        } catch (error) {
            console.error(`Error getting team info for ${teamName}:`, error);
            throw error;
        }
    }

    /**
     * ユーザー情報を取得
     */
    async getUserInfo(username) {
        try {
            const userInfo = await this.dynamoService.getUserInfo(username);
            return userInfo;

        } catch (error) {
            console.error(`Error getting user info for ${username}:`, error);
            throw error;
        }
    }

    /**
     * 全ユーザー一覧を取得
     */
    async getAllUsers() {
        try {
            const users = await this.dynamoService.getAllUsers();
            return users;

        } catch (error) {
            console.error('Error getting all users:', error);
            throw error;
        }
    }

    /**
     * PR詳細を取得
     */
    async getPRDetails(repository, prNumber) {
        try {
            const prDetails = await this.dynamoService.getPRDetails(repository, prNumber);
            return prDetails;

        } catch (error) {
            console.error(`Error getting PR details for ${repository}#${prNumber}:`, error);
            throw error;
        }
    }

    /**
     * キャッシュされたデータを取得（パフォーマンス向上）
     */
    async getCachedData(cacheType, fetchFunction, ttl = 3600) {
        try {
            // まずキャッシュを確認
            const cachedData = await this.dynamoService.getCache(cacheType, ttl);
            
            if (cachedData) {
                console.log(`Using cached data for ${cacheType}`);
                return cachedData;
            }

            // キャッシュがない場合は新しくデータを取得
            console.log(`Fetching fresh data for ${cacheType}`);
            const freshData = await fetchFunction();
            
            // 新しいデータをキャッシュに保存
            await this.dynamoService.saveCache(cacheType, freshData, ttl);
            
            return freshData;

        } catch (error) {
            console.error(`Error in getCachedData for ${cacheType}:`, error);
            throw error;
        }
    }

    /**
     * データの健全性チェック
     */
    async healthCheck() {
        try {
            const checks = {
                dynamodb: await this.dynamoService.healthCheck(),
                github_token: !!this.githubToken,
                timestamp: new Date().toISOString()
            };

            const isHealthy = checks.dynamodb.success && checks.github_token;

            return {
                success: isHealthy,
                checks: checks,
                message: isHealthy ? 'All systems operational' : 'Some systems have issues'
            };

        } catch (error) {
            console.error('Health check error:', error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * デバッグ情報を取得
     */
    async getDebugInfo() {
        try {
            const prData = await this.getStoredPRData();
            const teamData = await this.getStoredTeamData();
            const healthCheck = await this.healthCheck();

            return {
                pr_data_count: prData.pr_details ? prData.pr_details.length : 0,
                team_count: Object.keys(teamData.teams || {}).length,
                last_update: prData.updated_at || 'Never',
                period: prData.period || [],
                health: healthCheck,
                environment: {
                    region: process.env.AWS_REGION || 'ap-northeast-1',
                    table_name: process.env.DYNAMODB_TABLE_NAME || 'github-analyzer-data',
                    has_github_token: !!this.githubToken
                }
            };

        } catch (error) {
            console.error('Error getting debug info:', error);
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * データクリーンアップ
     */
    async cleanupOldData() {
        try {
            console.log('Starting data cleanup...');
            
            const result = await this.dynamoService.cleanupOldData();
            
            console.log('Data cleanup completed');
            return result;

        } catch (error) {
            console.error('Error during data cleanup:', error);
            throw error;
        }
    }
}

module.exports = GitHubApiService;