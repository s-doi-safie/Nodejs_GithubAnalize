#!/usr/bin/env node

/**
 * GitHub Analyzer Data Migration Script
 * 既存のJSONファイルからDynamoDBへデータを移行
 */

const fs = require('fs').promises;
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

// 色付きの出力用
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
    warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`)
};

class DataMigration {
    constructor() {
        this.client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'ap-northeast-1'
        });
        this.docClient = DynamoDBDocumentClient.from(this.client);
        this.tableName = process.env.DYNAMODB_TABLE_NAME || 'github-analyzer-data-dev';
        
        // プロジェクトのルートディレクトリを特定
        this.projectRoot = this.findProjectRoot();
        
        this.stats = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0
        };
    }

    /**
     * プロジェクトのルートディレクトリを見つける
     */
    findProjectRoot() {
        let currentDir = __dirname;
        
        // aws/scripts/migration から ../../.. でルートに戻る
        while (currentDir !== path.dirname(currentDir)) {
            const gitDir = path.join(currentDir, '.git');
            const packageJson = path.join(currentDir, 'package.json');
            
            try {
                if (require('fs').existsSync(gitDir) || require('fs').existsSync(packageJson)) {
                    return currentDir;
                }
            } catch (e) {
                // Continue searching
            }
            
            currentDir = path.dirname(currentDir);
        }
        
        // フォールバック: 3つ上のディレクトリ
        return path.resolve(__dirname, '../../..');
    }

    /**
     * 既存のJSONファイルを読み込み
     */
    async loadExistingData() {
        const dataFiles = [
            'github_data.json',
            'teams.json',
            'pulls_api_cache.json',
            'search_api_cache.json'
        ];

        const loadedData = {};

        for (const filename of dataFiles) {
            const filepath = path.join(this.projectRoot, filename);
            
            try {
                const content = await fs.readFile(filepath, 'utf8');
                const data = JSON.parse(content);
                loadedData[filename] = data;
                log.success(`Loaded ${filename} (${JSON.stringify(data).length} bytes)`);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    log.warning(`File not found: ${filename}`);
                } else {
                    log.error(`Error loading ${filename}: ${error.message}`);
                }
            }
        }

        return loadedData;
    }

    /**
     * GitHub PRデータを移行
     */
    async migratePRData(githubData) {
        if (!githubData) {
            log.warning('No GitHub PR data to migrate');
            return;
        }

        log.info('Migrating GitHub PR data...');

        const timestamp = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30日後

        try {
            // メインのPRデータを保存
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT',
                    data: githubData.data || {},
                    pr_details: githubData.pr_details || [],
                    period: githubData.period || [],
                    teams: githubData.teams || [],
                    users: githubData.users || [],
                    migrated_from: 'github_data.json',
                    updated_at: timestamp,
                    ttl: ttl
                }
            }));

            this.stats.succeeded++;
            log.success('Main PR data migrated successfully');

            // 個別のPR詳細を移行
            if (githubData.pr_details && Array.isArray(githubData.pr_details)) {
                await this.migratePRDetails(githubData.pr_details);
            }

        } catch (error) {
            log.error(`Failed to migrate PR data: ${error.message}`);
            this.stats.failed++;
        }
    }

    /**
     * 個別のPR詳細を移行
     */
    async migratePRDetails(prDetails) {
        log.info(`Migrating ${prDetails.length} PR details...`);

        const batchSize = 25; // DynamoDB BatchWrite の制限
        const batches = [];

        for (let i = 0; i < prDetails.length; i += batchSize) {
            const batch = prDetails.slice(i, i + batchSize);
            batches.push(batch);
        }

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            log.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);

            const putRequests = batch.map(pr => {
                const repository = pr.repository || 'unknown';
                const number = pr.number || pr.id || Math.random().toString(36).substr(2, 9);
                
                return {
                    PutRequest: {
                        Item: {
                            PK: `PR#${repository}#${number}`,
                            SK: 'METADATA',
                            ...pr,
                            migrated_from: 'github_data.json',
                            updated_at: new Date().toISOString(),
                            ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
                        }
                    }
                };
            });

            try {
                await this.docClient.send(new BatchWriteCommand({
                    RequestItems: {
                        [this.tableName]: putRequests
                    }
                }));

                this.stats.succeeded += batch.length;
                log.success(`Batch ${i + 1} completed successfully`);
            } catch (error) {
                log.error(`Batch ${i + 1} failed: ${error.message}`);
                this.stats.failed += batch.length;
            }

            // レート制限を避けるため少し待機
            if (i < batches.length - 1) {
                await this.sleep(100);
            }
        }
    }

    /**
     * チームデータを移行
     */
    async migrateTeamData(teamsData) {
        if (!teamsData) {
            log.warning('No team data to migrate');
            return;
        }

        log.info('Migrating team data...');

        const timestamp = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

        try {
            // 全体のチームデータを保存
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: 'TEAM_DATA',
                    SK: 'ALL_TEAMS',
                    teams: teamsData,
                    migrated_from: 'teams.json',
                    updated_at: timestamp,
                    ttl: ttl
                }
            }));

            this.stats.succeeded++;

            // 個別チーム情報を保存
            for (const [teamName, teamInfo] of Object.entries(teamsData)) {
                await this.docClient.send(new PutCommand({
                    TableName: this.tableName,
                    Item: {
                        PK: `TEAM#${teamName}`,
                        SK: 'INFO',
                        team_name: teamName,
                        ...teamInfo,
                        migrated_from: 'teams.json',
                        updated_at: timestamp,
                        ttl: ttl
                    }
                }));

                // チームメンバーも個別に保存
                if (teamInfo.members && Array.isArray(teamInfo.members)) {
                    for (const member of teamInfo.members) {
                        await this.docClient.send(new PutCommand({
                            TableName: this.tableName,
                            Item: {
                                PK: `USER#${member.login || member.username || member.name}`,
                                SK: 'PROFILE',
                                ...member,
                                team: teamName,
                                migrated_from: 'teams.json',
                                updated_at: timestamp,
                                ttl: ttl
                            }
                        }));

                        this.stats.succeeded++;
                    }
                }

                this.stats.succeeded++;
            }

            log.success(`Team data migrated successfully (${Object.keys(teamsData).length} teams)`);

        } catch (error) {
            log.error(`Failed to migrate team data: ${error.message}`);
            this.stats.failed++;
        }
    }

    /**
     * キャッシュデータを移行
     */
    async migrateCacheData(cacheData, cacheType) {
        if (!cacheData) {
            return;
        }

        log.info(`Migrating ${cacheType} cache data...`);

        const timestamp = new Date().toISOString();
        const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24時間

        try {
            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: `CACHE#${cacheType.toUpperCase()}`,
                    SK: timestamp,
                    data: cacheData,
                    migrated_from: `${cacheType}.json`,
                    cached_at: timestamp,
                    ttl: ttl
                }
            }));

            this.stats.succeeded++;
            log.success(`${cacheType} cache data migrated successfully`);

        } catch (error) {
            log.error(`Failed to migrate ${cacheType} cache: ${error.message}`);
            this.stats.failed++;
        }
    }

    /**
     * DynamoDBテーブルの存在確認
     */
    async verifyTable() {
        try {
            // 簡単なPutItem/GetItemテストでテーブルの存在と権限を確認
            const testKey = {
                PK: 'MIGRATION_TEST',
                SK: 'TEST'
            };

            await this.docClient.send(new PutCommand({
                TableName: this.tableName,
                Item: {
                    ...testKey,
                    timestamp: new Date().toISOString(),
                    ttl: Math.floor(Date.now() / 1000) + 60 // 1分後に削除
                }
            }));

            log.success(`Table ${this.tableName} is accessible`);
            return true;

        } catch (error) {
            log.error(`Table verification failed: ${error.message}`);
            return false;
        }
    }

    /**
     * 移行のバックアップを作成
     */
    async createBackup(data) {
        const backupDir = path.join(__dirname, 'backups');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `migration-backup-${timestamp}.json`);

        try {
            await fs.mkdir(backupDir, { recursive: true });
            await fs.writeFile(backupFile, JSON.stringify(data, null, 2));
            log.success(`Backup created: ${backupFile}`);
            return backupFile;
        } catch (error) {
            log.error(`Failed to create backup: ${error.message}`);
            return null;
        }
    }

    /**
     * 指定時間待機
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * メイン移行処理
     */
    async migrate() {
        log.info('Starting data migration...');
        log.info(`Target table: ${this.tableName}`);
        log.info(`Project root: ${this.projectRoot}`);

        // テーブルの確認
        if (!(await this.verifyTable())) {
            log.error('Migration aborted: Table verification failed');
            process.exit(1);
        }

        // 既存データの読み込み
        const existingData = await this.loadExistingData();

        if (Object.keys(existingData).length === 0) {
            log.warning('No data files found to migrate');
            return;
        }

        // バックアップの作成
        await this.createBackup(existingData);

        // データ移行の実行
        this.stats.processed = Object.keys(existingData).length;

        // GitHub PRデータの移行
        if (existingData['github_data.json']) {
            await this.migratePRData(existingData['github_data.json']);
        }

        // チームデータの移行
        if (existingData['teams.json']) {
            await this.migrateTeamData(existingData['teams.json']);
        }

        // キャッシュデータの移行
        if (existingData['pulls_api_cache.json']) {
            await this.migrateCacheData(existingData['pulls_api_cache.json'], 'pulls_api');
        }

        if (existingData['search_api_cache.json']) {
            await this.migrateCacheData(existingData['search_api_cache.json'], 'search_api');
        }

        // 結果の表示
        this.displayResults();
    }

    /**
     * 移行結果の表示
     */
    displayResults() {
        log.info('Migration completed!');
        console.log('\n' + '='.repeat(50));
        console.log('Migration Statistics:');
        console.log(`Processed: ${this.stats.processed}`);
        console.log(`Succeeded: ${this.stats.succeeded}`);
        console.log(`Failed: ${this.stats.failed}`);
        console.log(`Skipped: ${this.stats.skipped}`);
        console.log('='.repeat(50) + '\n');

        if (this.stats.failed > 0) {
            log.warning(`${this.stats.failed} items failed to migrate. Check the logs above for details.`);
            process.exit(1);
        } else {
            log.success('All items migrated successfully!');
        }
    }
}

// CLI実行
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
GitHub Analyzer Data Migration Script

Usage: node migrate-data.js [options]

Options:
  --table-name TABLE_NAME    DynamoDB table name (default: from env DYNAMODB_TABLE_NAME)
  --region REGION           AWS region (default: from env AWS_REGION or ap-northeast-1)
  --dry-run                 Show what would be migrated without actually migrating
  --help, -h                Show this help message

Environment Variables:
  DYNAMODB_TABLE_NAME       Target DynamoDB table name
  AWS_REGION               AWS region
  AWS_ACCESS_KEY_ID        AWS access key (if not using IAM roles)
  AWS_SECRET_ACCESS_KEY    AWS secret key (if not using IAM roles)

Examples:
  node migrate-data.js
  node migrate-data.js --table-name my-table --region us-east-1
  node migrate-data.js --dry-run
        `);
        process.exit(0);
    }

    // 引数の解析
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--table-name':
                process.env.DYNAMODB_TABLE_NAME = args[++i];
                break;
            case '--region':
                process.env.AWS_REGION = args[++i];
                break;
            case '--dry-run':
                log.warning('Dry-run mode not implemented yet');
                process.exit(0);
                break;
        }
    }

    // 移行の実行
    const migration = new DataMigration();
    migration.migrate().catch(error => {
        log.error(`Migration failed: ${error.message}`);
        if (process.env.NODE_ENV === 'development') {
            console.error(error.stack);
        }
        process.exit(1);
    });
}

module.exports = DataMigration;