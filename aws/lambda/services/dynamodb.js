const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchGetCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { logger } = require('./s3-logger');
const { getCompressor } = require('../utils/data-compressor');

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
        this.compressor = getCompressor();
        
        // 圧縮対象フィールド
        this.compressibleFields = ['pr_details', 'data', 'teams', 'members'];
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
                    ttl: Math.floor(Date.now() / 1000) + (180 * 24 * 60 * 60) // 180日後にTTL
                }
            }));

            // 個別のPR詳細をバッチで保存
            if (prData.pr_details && prData.pr_details.length > 0) {
                const batches = [];
                for (let i = 0; i < prData.pr_details.length; i += 25) {
                    const batch = prData.pr_details.slice(i, i + 25);
                    const putRequests = batch.map(pr => ({
                        PutRequest: {
                            Item: {
                                PK: `PR#${pr.repository}#${pr.number}`,
                                SK: 'METADATA',
                                ...pr,
                                updated_at: timestamp,
                                ttl: Math.floor(Date.now() / 1000) + (180 * 24 * 60 * 60)
                            }
                        }
                    }));
                    batches.push(putRequests);
                }
                
                // バッチ書き込み実行
                for (const batch of batches) {
                    await this.docClient.send(new BatchWriteCommand({
                        RequestItems: {
                            [this.tableName]: batch
                        }
                    }));
                }
            }

            logger.info('PR data saved successfully', { count: prData.pr_details.length });
            return { success: true, timestamp };

        } catch (error) {
            logger.error(error, { context: 'savePRData' });
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
            logger.error(error, { context: 'getPRData' });
            throw error;
        }
    }

    /**
     * チームデータを保存
     */
    async saveTeamData(teamData) {
        try {
            const timestamp = new Date().toISOString();
            
            // 全体のチームデータを圧縮して保存
            const compressedTeamItem = await this.compressor.compressLargeFields({
                PK: 'TEAM_DATA',
                SK: 'ALL_TEAMS',
                teams: teamData,
                updated_at: timestamp,
                ttl: Math.floor(Date.now() / 1000) + (180 * 24 * 60 * 60)
            }, ['teams']);
            
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: compressedTeamItem
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

            logger.info('Team data saved successfully', { teams: Object.keys(teamData).length });
            return { success: true, timestamp };

        } catch (error) {
            logger.error(error, { context: 'saveTeamData' });
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
            logger.error(error, { context: 'getTeamData' });
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
            logger.error(error, { context: 'getTeamInfo', teamName });
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
            logger.error(error, { context: 'getUserInfo', username });
            throw error;
        }
    }

    /**
     * 全ユーザー一覧を取得（Query使用）
     */
    async getAllUsers() {
        try {
            // チームデータから全ユーザーを取得する方法に変更
            const teamData = await this.getTeamData();
            const users = [];
            
            for (const teamInfo of Object.values(teamData)) {
                if (teamInfo.members) {
                    users.push(...teamInfo.members);
                }
            }
            
            // 重複を除去
            const uniqueUsers = Array.from(
                new Map(users.map(user => [user.login, user])).values()
            );
            
            return uniqueUsers;

        } catch (error) {
            logger.error(error, { context: 'getAllUsers' });
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
            logger.error(error, { context: 'getPRDetails', repository, prNumber });
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

            logger.debug(`Cache saved for ${cacheType}`, { ttl: ttlSeconds });
            return { success: true, timestamp };

        } catch (error) {
            logger.error(error, { context: 'saveCache', cacheType });
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
            logger.warn(`Cache miss for ${cacheType}`, { error: error.message });
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
            
            logger.info('Cleanup skipped - using DynamoDB TTL for automatic deletion');
            return { success: true };

        } catch (error) {
            logger.error(error, { context: 'cleanupOldData' });
            throw error;
        }
    }

    /**
     * 複数のPR詳細をバッチで取得
     */
    async batchGetPRDetails(prList) {
        try {
            if (!prList || prList.length === 0) {
                return [];
            }

            const results = [];
            
            // 100件ずつバッチ取得
            for (let i = 0; i < prList.length; i += 100) {
                const batch = prList.slice(i, i + 100);
                const keys = batch.map(pr => ({
                    PK: `PR#${pr.repository}#${pr.number}`,
                    SK: 'METADATA'
                }));

                const response = await this.docClient.send(new BatchGetCommand({
                    RequestItems: {
                        [this.tableName]: {
                            Keys: keys
                        }
                    }
                }));

                if (response.Responses && response.Responses[this.tableName]) {
                    results.push(...response.Responses[this.tableName]);
                }
            }

            return results;

        } catch (error) {
            logger.error(error, { context: 'batchGetPRDetails' });
            throw error;
        }
    }

    /**
     * 複数のチーム情報をバッチで取得
     */
    async batchGetTeams(teamNames) {
        try {
            if (!teamNames || teamNames.length === 0) {
                return {};
            }

            const keys = teamNames.map(teamName => ({
                PK: `TEAM#${teamName}`,
                SK: 'INFO'
            }));

            const response = await this.docClient.send(new BatchGetCommand({
                RequestItems: {
                    [this.tableName]: {
                        Keys: keys
                    }
                }
            }));

            const teams = {};
            if (response.Responses && response.Responses[this.tableName]) {
                for (const item of response.Responses[this.tableName]) {
                    teams[item.team_name] = item;
                }
            }

            return teams;

        } catch (error) {
            logger.error(error, { context: 'batchGetTeams' });
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
            logger.error(error, { context: 'healthCheck' });
            return { 
                success: false, 
                error: error.message,
                tableName: this.tableName 
            };
        }
    }
}

module.exports = DynamoDBService;