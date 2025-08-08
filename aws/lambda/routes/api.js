const GitHubApiService = require('../services/github-api');
const DataProcessor = require('../services/data-processor');
const { logger } = require('../services/s3-logger');
const { getCache } = require('../services/cache-manager');

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
            logger.info(`API Request: ${httpMethod} ${path}`);

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
                
                case '/api/batch':
                    if (httpMethod === 'POST') {
                        return await this.batchOperation(body);
                    }
                    break;

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
            logger.error(error, { context: 'API Router' });
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
            logger.error(error, { context: 'getReviewData' });
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
            logger.error(error, { context: 'getTeams' });
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

            logger.info('Fetching PR data', { fromDate, toDate, teams, users });

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
            logger.error(error, { context: 'runPythonScript' });
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
            logger.info('Updating team information');

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
            logger.error(error, { context: 'updateTeams' });
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
            logger.error(error, { context: 'healthCheck' });
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
            logger.error(error, { context: 'getDebugInfo' });
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
            logger.error(error, { context: 'getStatistics' });
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
            logger.error(error, { context: 'Auth validation' });
            return { isValid: false, error: 'Invalid token' };
        }
    }
    
    /**
     * バッチ操作エンドポイント
     */
    async batchOperation(body) {
        try {
            const { operations } = body || {};
            
            if (!operations || !Array.isArray(operations)) {
                return {
                    statusCode: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: { error: 'operations array is required' }
                };
            }
            
            const results = {};
            const errors = {};
            const cache = getCache();
            
            // 並列処理で各操作を実行
            await Promise.all(operations.map(async (op) => {
                try {
                    const { type, params } = op;
                    
                    // キャッシュチェック
                    const cacheKey = cache.generateKey(`batch:${type}`, params || {});
                    const cached = cache.get(cacheKey);
                    if (cached) {
                        results[type] = cached;
                        return;
                    }
                    
                    // タイプ別の処理
                    switch (type) {
                        case 'review-data':
                            const reviewData = await this.getReviewData();
                            results[type] = reviewData.body;
                            cache.set(cacheKey, reviewData.body, 300000);
                            break;
                            
                        case 'teams':
                            const teamsData = await this.getTeams();
                            results[type] = teamsData.body;
                            cache.set(cacheKey, teamsData.body, 600000);
                            break;
                            
                        case 'statistics':
                            const statsData = await this.getStatistics();
                            results[type] = statsData.body;
                            cache.set(cacheKey, statsData.body, 300000);
                            break;
                            
                        case 'pr-details':
                            if (params && params.repository && params.prNumber) {
                                const prDetails = await this.githubService.getPRDetails(
                                    params.repository,
                                    params.prNumber
                                );
                                results[type] = prDetails;
                                cache.set(cacheKey, prDetails, 600000);
                            } else {
                                errors[type] = 'Missing required params: repository, prNumber';
                            }
                            break;
                            
                        case 'team-info':
                            if (params && params.teamName) {
                                const teamInfo = await this.githubService.getTeamInfo(params.teamName);
                                results[type] = teamInfo;
                                cache.set(cacheKey, teamInfo, 600000);
                            } else {
                                errors[type] = 'Missing required param: teamName';
                            }
                            break;
                            
                        case 'user-info':
                            if (params && params.username) {
                                const userInfo = await this.githubService.getUserInfo(params.username);
                                results[type] = userInfo;
                                cache.set(cacheKey, userInfo, 600000);
                            } else {
                                errors[type] = 'Missing required param: username';
                            }
                            break;
                            
                        default:
                            errors[type] = `Unknown operation type: ${type}`;
                    }
                } catch (error) {
                    errors[op.type] = error.message;
                    logger.error(error, { context: 'batchOperation', type: op.type });
                }
            }));
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: {
                    results,
                    errors: Object.keys(errors).length > 0 ? errors : undefined,
                    cached: cache.getStats()
                }
            };
            
        } catch (error) {
            logger.error(error, { context: 'batchOperation' });
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Failed to process batch operations' }
            };
        }
    }
}

module.exports = ApiRouter;