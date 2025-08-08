const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * DynamoDB操作サービスクラス
 * 単一テーブル設計でGitHub PR分析データを管理
 */
class DynamoDBService {
    constructor() {
        this.client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'ap-northeast-1'
        });
        this.docClient = DynamoDBDocumentClient.from(this.client);
        this.tableName = process.env.DYNAMODB_TABLE_NAME || 'github-analyzer-data';
    }

    /**
     * PRデータを保存
     */
    async savePRData(prData, period) {
        try {
            const timestamp = new Date().toISOString();
            
            // PR分析データを保存
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT',
                    data: prData.data,
                    pr_details: prData.pr_details,
                    period: period,
                    teams: prData.teams || [],
                    users: prData.users || [],
                    updated_at: timestamp,
                    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30日後にTTL
                }
            }));

            // 個別のPR詳細も保存
            for (const pr of prData.pr_details) {
                await this.docClient.send(new PutCommand({
                    TableName: this.tableName,
                    Item: {
                        PK: `PR#${pr.repository}#${pr.number}`,
                        SK: 'METADATA',
                        ...pr,
                        updated_at: timestamp,
                        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                    }
                }));
            }

            console.log('PR data saved successfully');
            return { success: true, timestamp };

        } catch (error) {
            console.error('Error saving PR data:', error);
            throw error;
        }
    }

    /**
     * PRデータを取得
     */
    async getPRData() {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT'
                }
            }));

            if (!result.Item) {
                return {
                    data: {},
                    pr_details: [],
                    period: [new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[0]],
                    teams: [],
                    users: []
                };
            }

            return {
                data: result.Item.data || {},
                pr_details: result.Item.pr_details || [],
                period: result.Item.period || [],
                teams: result.Item.teams || [],
                users: result.Item.users || []
            };

        } catch (error) {
            console.error('Error getting PR data:', error);
            throw error;
        }
    }

    /**
     * チームデータを保存
     */
    async saveTeamData(teamData) {
        try {
            const timestamp = new Date().toISOString();
            
            // 全体のチームデータを保存
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: 'TEAM_DATA',
                    SK: 'ALL_TEAMS',
                    teams: teamData,
                    updated_at: timestamp,
                    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                }
            }));

            // 個別チーム情報も保存
            for (const [teamName, teamInfo] of Object.entries(teamData)) {
                await this.docClient.send(new PutCommand({
                    TableName: this.tableName,
                    Item: {
                        PK: `TEAM#${teamName}`,
                        SK: 'INFO',
                        team_name: teamName,
                        ...teamInfo,
                        updated_at: timestamp,
                        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                    }
                }));

                // チームメンバーも個別に保存
                for (const member of teamInfo.members || []) {
                    await this.docClient.send(new PutCommand({
                        TableName: this.tableName,
                        Item: {
                            PK: `USER#${member.login}`,
                            SK: 'PROFILE',
                            login: member.login,
                            name: member.name,
                            avatar_url: member.avatar_url,
                            team: teamName,
                            updated_at: timestamp,
                            ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                        }
                    }));
                }
            }

            console.log('Team data saved successfully');
            return { success: true, timestamp };

        } catch (error) {
            console.error('Error saving team data:', error);
            throw error;
        }
    }

    /**
     * チームデータを取得
     */
    async getTeamData() {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'TEAM_DATA',
                    SK: 'ALL_TEAMS'
                }
            }));

            return result.Item?.teams || {};

        } catch (error) {
            console.error('Error getting team data:', error);
            throw error;
        }
    }

    /**
     * 特定チームの情報を取得
     */
    async getTeamInfo(teamName) {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `TEAM#${teamName}`,
                    SK: 'INFO'
                }
            }));

            return result.Item || null;

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
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `USER#${username}`,
                    SK: 'PROFILE'
                }
            }));

            return result.Item || null;

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
            const result = await this.docClient.send(new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'begins_with(PK, :pk_prefix) AND SK = :sk',
                ExpressionAttributeValues: {
                    ':pk_prefix': 'USER#',
                    ':sk': 'PROFILE'
                }
            }));

            return result.Items || [];

        } catch (error) {
            console.error('Error getting all users:', error);
            throw error;
        }
    }

    /**
     * 特定のPR詳細を取得
     */
    async getPRDetails(repository, prNumber) {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: `PR#${repository}#${prNumber}`,
                    SK: 'METADATA'
                }
            }));

            return result.Item || null;

        } catch (error) {
            console.error(`Error getting PR details for ${repository}#${prNumber}:`, error);
            throw error;
        }
    }

    /**
     * キャッシュデータを保存
     */
    async saveCache(cacheType, data, ttlSeconds = 3600) {
        try {
            const timestamp = new Date().toISOString();
            
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `CACHE#${cacheType}`,
                    SK: timestamp,
                    data: data,
                    cached_at: timestamp,
                    ttl: Math.floor(Date.now() / 1000) + ttlSeconds
                }
            }));

            console.log(`Cache saved for ${cacheType}`);
            return { success: true, timestamp };

        } catch (error) {
            console.error(`Error saving cache for ${cacheType}:`, error);
            throw error;
        }
    }

    /**
     * キャッシュデータを取得
     */
    async getCache(cacheType, maxAge = 3600) {
        try {
            const cutoffTime = new Date(Date.now() - (maxAge * 1000)).toISOString();
            
            const result = await this.docClient.send(new QueryCommand({
                TableName: this.tableName,
                KeyConditionExpression: 'PK = :pk AND SK >= :cutoff',
                ExpressionAttributeValues: {
                    ':pk': `CACHE#${cacheType}`,
                    ':cutoff': cutoffTime
                },
                ScanIndexForward: false, // 最新から取得
                Limit: 1
            }));

            if (result.Items && result.Items.length > 0) {
                return result.Items[0].data;
            }

            return null;

        } catch (error) {
            console.error(`Error getting cache for ${cacheType}:`, error);
            return null; // キャッシュエラーは例外を投げない
        }
    }

    /**
     * 古いデータをクリーンアップ
     */
    async cleanupOldData() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30); // 30日前
            
            console.log('Starting cleanup of old data...');
            
            // TTLが設定されているため、自動削除される
            // 必要に応じて手動クリーンアップロジックを追加
            
            console.log('Cleanup completed');
            return { success: true };

        } catch (error) {
            console.error('Error during cleanup:', error);
            throw error;
        }
    }

    /**
     * テーブルの存在確認とヘルスチェック
     */
    async healthCheck() {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'HEALTH_CHECK',
                    SK: 'TEST'
                }
            }));

            // テスト用データを保存してみる
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: 'HEALTH_CHECK',
                    SK: 'TEST',
                    timestamp: new Date().toISOString(),
                    ttl: Math.floor(Date.now() / 1000) + 60 // 1分後にTTL
                }
            }));

            return { 
                success: true, 
                tableName: this.tableName,
                region: process.env.AWS_REGION || 'ap-northeast-1'
            };

        } catch (error) {
            console.error('DynamoDB health check failed:', error);
            return { 
                success: false, 
                error: error.message,
                tableName: this.tableName 
            };
        }
    }
}

module.exports = DynamoDBService;