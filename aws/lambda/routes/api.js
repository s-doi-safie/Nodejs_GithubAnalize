const GitHubApiService = require('../services/github-api');
const DataProcessor = require('../services/data-processor');

/**
 * API ルーター
 * GitHub PR分析のAPIエンドポイントを処理
 */
class ApiRouter {
    constructor() {
        this.githubService = new GitHubApiService();
        this.dataProcessor = new DataProcessor();
    }

    /**
     * APIリクエストを処理
     */
    async handle(request) {
        const { httpMethod, path, body, queryStringParameters } = request;

        try {
            console.log(`API Request: ${httpMethod} ${path}`);

            // ルーティング
            switch (path) {
                case '/api/review-data':
                    return await this.getReviewData();

                case '/api/teams':
                    return await this.getTeams();

                case '/run-python':
                    if (httpMethod === 'POST') {
                        return await this.runPythonScript(body);
                    }
                    break;

                case '/update-teams':
                    if (httpMethod === 'POST') {
                        return await this.updateTeams();
                    }
                    break;

                case '/api/health':
                    return await this.healthCheck();

                case '/api/debug':
                    return await this.getDebugInfo();

                case '/api/stats':
                    return await this.getStatistics();

                default:
                    return {
                        statusCode: 404,
                        headers: { 'Content-Type': 'application/json' },
                        body: { error: 'API endpoint not found' }
                    };
            }

            return {
                statusCode: 405,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Method not allowed' }
            };

        } catch (error) {
            console.error('API Error:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { 
                    error: 'Internal server error',
                    message: error.message
                }
            };
        }
    }

    /**
     * レビューデータを取得
     */
    async getReviewData() {
        try {
            const prData = await this.githubService.getStoredPRData();
            const teamData = await this.githubService.getStoredTeamData();
            
            // データを検証・修正
            const validatedData = this.dataProcessor.validateAndFixData(prData);
            
            // 非メンバーとボットを除外
            const filteredData = this.dataProcessor.filterNonMembers(
                validatedData, 
                teamData.teams
            );

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: filteredData
            };

        } catch (error) {
            console.error('Error in getReviewData:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Failed to get review data' }
            };
        }
    }

    /**
     * チーム情報を取得
     */
    async getTeams() {
        try {
            const teamData = await this.githubService.getStoredTeamData();

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: teamData
            };

        } catch (error) {
            console.error('Error in getTeams:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Failed to get teams' }
            };
        }
    }

    /**
     * Pythonスクリプト実行（PRデータ更新）
     */
    async runPythonScript(body) {
        try {
            const { fromDate, toDate, teams = [], users = [] } = body || {};

            if (!fromDate || !toDate) {
                return {
                    statusCode: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: { error: 'fromDate and toDate are required' }
                };
            }

            console.log(`Fetching PR data from ${fromDate} to ${toDate}`);
            console.log(`Teams: ${JSON.stringify(teams)}`);
            console.log(`Users: ${JSON.stringify(users)}`);

            const result = await this.githubService.fetchAndUpdatePRData(
                fromDate, 
                toDate, 
                teams, 
                users
            );

            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: { 
                        message: result.message,
                        data: 'Updated successfully'
                    }
                };
            } else {
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: { error: result.error }
                };
            }

        } catch (error) {
            console.error('Error in runPythonScript:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Failed to fetch or parse data' }
            };
        }
    }

    /**
     * チーム情報を更新
     */
    async updateTeams() {
        try {
            console.log('Updating team information...');

            const result = await this.githubService.updateTeamInfo();

            if (result.success) {
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: {
                        message: result.message,
                        data: 'Updated successfully'
                    }
                };
            } else {
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: { error: result.error }
                };
            }

        } catch (error) {
            console.error('Error in updateTeams:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'チーム情報の更新に失敗しました' }
            };
        }
    }

    /**
     * ヘルスチェック
     */
    async healthCheck() {
        try {
            const health = await this.githubService.healthCheck();

            return {
                statusCode: health.success ? 200 : 503,
                headers: { 'Content-Type': 'application/json' },
                body: health
            };

        } catch (error) {
            console.error('Error in healthCheck:', error);
            return {
                statusCode: 503,
                headers: { 'Content-Type': 'application/json' },
                body: { 
                    success: false, 
                    error: error.message,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    /**
     * デバッグ情報を取得
     */
    async getDebugInfo() {
        try {
            const debugInfo = await this.githubService.getDebugInfo();

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: debugInfo
            };

        } catch (error) {
            console.error('Error in getDebugInfo:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: error.message }
            };
        }
    }

    /**
     * 統計情報を取得
     */
    async getStatistics() {
        try {
            const prData = await this.githubService.getStoredPRData();
            const teamData = await this.githubService.getStoredTeamData();
            
            // PR統計を計算
            const prStats = this.dataProcessor.calculatePRStatistics(prData.pr_details || []);
            
            // 期間別分析（週別）
            const weeklyData = this.dataProcessor.analyzePeriodData(prData.pr_details || [], 7);
            
            // レビュー効率性分析
            const reviewEfficiency = this.dataProcessor.analyzeReviewEfficiency(prData.pr_details || []);
            
            // チーム貢献度分析
            const teamContributions = this.dataProcessor.analyzeTeamContributions(prData, teamData.teams);

            const statistics = {
                pr_statistics: prStats,
                weekly_analysis: weeklyData,
                review_efficiency: reviewEfficiency,
                team_contributions: teamContributions,
                generated_at: new Date().toISOString(),
                period: prData.period || []
            };

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: statistics
            };

        } catch (error) {
            console.error('Error in getStatistics:', error);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Failed to generate statistics' }
            };
        }
    }

    /**
     * 認証情報の検証（Cognito JWT）
     */
    validateAuth(request) {
        const authHeader = request.headers?.Authorization || request.headers?.authorization;
        
        if (!authHeader) {
            return { isValid: false, error: 'No authorization header' };
        }

        try {
            const token = authHeader.replace('Bearer ', '');
            
            // JWT検証は API Gateway の Cognito Authorizer で実施済み
            // ここでは追加のビジネスロジック検証があれば実装
            
            return { isValid: true };

        } catch (error) {
            console.error('Auth validation error:', error);
            return { isValid: false, error: 'Invalid token' };
        }
    }
}

module.exports = ApiRouter;