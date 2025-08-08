#!/usr/bin/env node

/**
 * GitHub Analyzer Migration Validation Script
 * 移行されたデータの整合性を検証
 */

const fs = require('fs').promises;
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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

class MigrationValidator {
    constructor() {
        this.client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'ap-northeast-1'
        });
        this.docClient = DynamoDBDocumentClient.from(this.client);
        this.tableName = process.env.DYNAMODB_TABLE_NAME || 'github-analyzer-data-dev';
        
        this.projectRoot = this.findProjectRoot();
        this.validationResults = {
            passed: 0,
            failed: 0,
            warnings: 0,
            tests: []
        };
    }

    /**
     * プロジェクトのルートディレクトリを見つける
     */
    findProjectRoot() {
        let currentDir = __dirname;
        
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
        
        return path.resolve(__dirname, '../../..');
    }

    /**
     * テスト結果を記録
     */
    recordTest(name, passed, message = '') {
        this.validationResults.tests.push({
            name,
            passed,
            message,
            timestamp: new Date().toISOString()
        });

        if (passed) {
            this.validationResults.passed++;
            log.success(`✓ ${name}`);
        } else {
            this.validationResults.failed++;
            log.error(`✗ ${name}: ${message}`);
        }

        if (message && passed) {
            log.info(`  ${message}`);
        }
    }

    /**
     * 警告を記録
     */
    recordWarning(name, message) {
        this.validationResults.warnings++;
        this.validationResults.tests.push({
            name,
            passed: true,
            message,
            warning: true,
            timestamp: new Date().toISOString()
        });
        log.warning(`⚠ ${name}: ${message}`);
    }

    /**
     * DynamoDBから移行されたPRデータを取得
     */
    async getMigratedPRData() {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT'
                }
            }));

            return result.Item || null;
        } catch (error) {
            log.error(`Failed to get migrated PR data: ${error.message}`);
            return null;
        }
    }

    /**
     * DynamoDBから移行されたチームデータを取得
     */
    async getMigratedTeamData() {
        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'TEAM_DATA',
                    SK: 'ALL_TEAMS'
                }
            }));

            return result.Item || null;
        } catch (error) {
            log.error(`Failed to get migrated team data: ${error.message}`);
            return null;
        }
    }

    /**
     * 元のJSONファイルを読み込み
     */
    async loadOriginalData() {
        const dataFiles = ['github_data.json', 'teams.json'];
        const originalData = {};

        for (const filename of dataFiles) {
            const filepath = path.join(this.projectRoot, filename);
            
            try {
                const content = await fs.readFile(filepath, 'utf8');
                originalData[filename] = JSON.parse(content);
            } catch (error) {
                log.warning(`Could not load original ${filename}: ${error.message}`);
            }
        }

        return originalData;
    }

    /**
     * PRデータの整合性を検証
     */
    async validatePRData(originalData, migratedData) {
        log.info('Validating PR data migration...');

        if (!originalData['github_data.json']) {
            this.recordWarning('PR Data Source', 'Original github_data.json not found');
            return;
        }

        if (!migratedData) {
            this.recordTest('PR Data Migration', false, 'No migrated PR data found in DynamoDB');
            return;
        }

        const original = originalData['github_data.json'];
        
        // データ構造の検証
        const hasData = migratedData.data && typeof migratedData.data === 'object';
        this.recordTest('PR Data Structure', hasData, hasData ? 'Data object exists' : 'Data object missing');

        const hasPRDetails = migratedData.pr_details && Array.isArray(migratedData.pr_details);
        this.recordTest('PR Details Structure', hasPRDetails, hasPRDetails ? `${migratedData.pr_details.length} PR details` : 'PR details missing');

        // 期間データの検証
        const hasPeriod = migratedData.period && Array.isArray(migratedData.period);
        this.recordTest('Period Data', hasPeriod, hasPeriod ? `Period: ${migratedData.period.join(' to ')}` : 'Period data missing');

        // データ量の比較
        if (original.data && migratedData.data) {
            const originalUserCount = Object.keys(original.data).length;
            const migratedUserCount = Object.keys(migratedData.data).length;
            const usersMatch = originalUserCount === migratedUserCount;
            
            this.recordTest('User Count Match', usersMatch, 
                `Original: ${originalUserCount}, Migrated: ${migratedUserCount}`);
        }

        if (original.pr_details && migratedData.pr_details) {
            const originalPRCount = original.pr_details.length;
            const migratedPRCount = migratedData.pr_details.length;
            const prsMatch = originalPRCount === migratedPRCount;
            
            this.recordTest('PR Count Match', prsMatch,
                `Original: ${originalPRCount}, Migrated: ${migratedPRCount}`);
        }

        // 移行メタデータの検証
        const hasMigrationInfo = migratedData.migrated_from && migratedData.updated_at;
        this.recordTest('Migration Metadata', hasMigrationInfo, 
            hasMigrationInfo ? `Migrated from ${migratedData.migrated_from} at ${migratedData.updated_at}` : 'Migration metadata missing');
    }

    /**
     * チームデータの整合性を検証
     */
    async validateTeamData(originalData, migratedData) {
        log.info('Validating team data migration...');

        if (!originalData['teams.json']) {
            this.recordWarning('Team Data Source', 'Original teams.json not found');
            return;
        }

        if (!migratedData) {
            this.recordTest('Team Data Migration', false, 'No migrated team data found in DynamoDB');
            return;
        }

        const original = originalData['teams.json'];
        const migrated = migratedData.teams;

        // チーム数の比較
        const originalTeamCount = Object.keys(original).length;
        const migratedTeamCount = Object.keys(migrated).length;
        const teamsMatch = originalTeamCount === migratedTeamCount;
        
        this.recordTest('Team Count Match', teamsMatch,
            `Original: ${originalTeamCount}, Migrated: ${migratedTeamCount}`);

        // チーム名の比較
        const originalTeamNames = new Set(Object.keys(original));
        const migratedTeamNames = new Set(Object.keys(migrated));
        const namesMatch = originalTeamNames.size === migratedTeamNames.size &&
            [...originalTeamNames].every(name => migratedTeamNames.has(name));
        
        this.recordTest('Team Names Match', namesMatch,
            namesMatch ? 'All team names preserved' : 'Team name mismatch detected');

        // メンバー数の比較（サンプル）
        let totalMemberMismatch = 0;
        for (const teamName of Object.keys(original)) {
            if (migrated[teamName]) {
                const originalMembers = original[teamName].members || [];
                const migratedMembers = migrated[teamName].members || [];
                
                if (originalMembers.length !== migratedMembers.length) {
                    totalMemberMismatch++;
                }
            }
        }

        this.recordTest('Team Members Count', totalMemberMismatch === 0,
            totalMemberMismatch > 0 ? `${totalMemberMismatch} teams have member count mismatches` : 'All team member counts match');
    }

    /**
     * 個別PRレコードの検証（サンプリング）
     */
    async validateIndividualPRRecords() {
        log.info('Validating individual PR records (sampling)...');

        try {
            // PR#で始まるレコードをサンプリング
            const result = await this.docClient.send(new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'begins_with(PK, :pk_prefix)',
                ExpressionAttributeValues: {
                    ':pk_prefix': 'PR#'
                },
                Limit: 10 // サンプルサイズ
            }));

            const prRecords = result.Items || [];
            
            this.recordTest('Individual PR Records Exist', prRecords.length > 0,
                `Found ${prRecords.length} individual PR records`);

            // 各レコードの必須フィールドを検証
            let validRecords = 0;
            for (const record of prRecords) {
                if (record.PK && record.SK && record.updated_at) {
                    validRecords++;
                }
            }

            this.recordTest('PR Records Structure Valid', validRecords === prRecords.length,
                `${validRecords}/${prRecords.length} records have valid structure`);

        } catch (error) {
            this.recordTest('Individual PR Records Validation', false, error.message);
        }
    }

    /**
     * ユーザープロファイルレコードの検証
     */
    async validateUserProfiles() {
        log.info('Validating user profile records...');

        try {
            const result = await this.docClient.send(new ScanCommand({
                TableName: this.tableName,
                FilterExpression: 'begins_with(PK, :pk_prefix) AND SK = :sk',
                ExpressionAttributeValues: {
                    ':pk_prefix': 'USER#',
                    ':sk': 'PROFILE'
                },
                Limit: 20
            }));

            const userRecords = result.Items || [];
            
            this.recordTest('User Profile Records Exist', userRecords.length > 0,
                `Found ${userRecords.length} user profile records`);

            // ユーザーレコードの必須フィールドを検証
            let validUsers = 0;
            for (const user of userRecords) {
                if (user.login || user.username) {
                    validUsers++;
                }
            }

            this.recordTest('User Profiles Valid', validUsers === userRecords.length,
                `${validUsers}/${userRecords.length} user profiles have valid identifiers`);

        } catch (error) {
            this.recordTest('User Profiles Validation', false, error.message);
        }
    }

    /**
     * TTL設定の検証
     */
    async validateTTLSettings() {
        log.info('Validating TTL settings...');

        try {
            const result = await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT'
                }
            }));

            if (result.Item && result.Item.ttl) {
                const ttl = result.Item.ttl;
                const now = Math.floor(Date.now() / 1000);
                const ttlValid = ttl > now;
                
                const ttlDate = new Date(ttl * 1000).toISOString();
                this.recordTest('TTL Settings Valid', ttlValid,
                    `TTL set to ${ttlDate}`);
            } else {
                this.recordWarning('TTL Settings', 'TTL not found on main PR data record');
            }

        } catch (error) {
            this.recordTest('TTL Validation', false, error.message);
        }
    }

    /**
     * データ完全性の検証（ハッシュチェック）
     */
    async validateDataIntegrity(originalData, migratedData) {
        log.info('Validating data integrity...');

        if (!originalData['github_data.json'] || !migratedData) {
            this.recordWarning('Data Integrity', 'Cannot perform integrity check without both original and migrated data');
            return;
        }

        try {
            // 簡易的な整合性チェック：主要なフィールドのハッシュ比較
            const crypto = require('crypto');
            
            const originalUsers = Object.keys(originalData['github_data.json'].data || {}).sort();
            const migratedUsers = Object.keys(migratedData.data || {}).sort();
            
            const originalHash = crypto.createHash('md5').update(JSON.stringify(originalUsers)).digest('hex');
            const migratedHash = crypto.createHash('md5').update(JSON.stringify(migratedUsers)).digest('hex');
            
            const usersIntegrityMatch = originalHash === migratedHash;
            this.recordTest('User Data Integrity', usersIntegrityMatch,
                usersIntegrityMatch ? 'User data integrity verified' : 'User data integrity mismatch');

        } catch (error) {
            this.recordTest('Data Integrity Check', false, error.message);
        }
    }

    /**
     * パフォーマンステスト
     */
    async validatePerformance() {
        log.info('Running performance tests...');

        try {
            // 読み取りパフォーマンステスト
            const startTime = Date.now();
            
            await this.docClient.send(new GetCommand({
                TableName: this.tableName,
                Key: {
                    PK: 'PR_DATA',
                    SK: 'CURRENT'
                }
            }));
            
            const readTime = Date.now() - startTime;
            
            const readPerformanceGood = readTime < 100; // 100ms以下
            this.recordTest('Read Performance', readPerformanceGood,
                `Read time: ${readTime}ms`);

        } catch (error) {
            this.recordTest('Performance Test', false, error.message);
        }
    }

    /**
     * メイン検証処理
     */
    async validate() {
        log.info('Starting migration validation...');
        log.info(`Target table: ${this.tableName}`);

        // 元のデータを読み込み
        const originalData = await this.loadOriginalData();
        
        // 移行されたデータを取得
        const migratedPRData = await this.getMigratedPRData();
        const migratedTeamData = await this.getMigratedTeamData();

        // 各種検証の実行
        await this.validatePRData(originalData, migratedPRData);
        await this.validateTeamData(originalData, migratedTeamData);
        await this.validateIndividualPRRecords();
        await this.validateUserProfiles();
        await this.validateTTLSettings();
        await this.validateDataIntegrity(originalData, migratedPRData);
        await this.validatePerformance();

        // 結果の表示
        this.displayResults();
    }

    /**
     * 検証結果の表示
     */
    displayResults() {
        console.log('\n' + '='.repeat(60));
        console.log('Migration Validation Results');
        console.log('='.repeat(60));
        
        console.log(`Total Tests: ${this.validationResults.tests.length}`);
        console.log(`Passed: ${this.validationResults.passed}`);
        console.log(`Failed: ${this.validationResults.failed}`);
        console.log(`Warnings: ${this.validationResults.warnings}`);
        
        if (this.validationResults.failed > 0) {
            console.log('\n' + colors.red + 'VALIDATION FAILED' + colors.reset);
            console.log('Failed tests:');
            this.validationResults.tests
                .filter(test => !test.passed)
                .forEach(test => {
                    console.log(`  ✗ ${test.name}: ${test.message}`);
                });
        } else {
            console.log('\n' + colors.green + 'VALIDATION PASSED' + colors.reset);
            log.success('All validation tests passed successfully!');
        }

        if (this.validationResults.warnings > 0) {
            console.log('\nWarnings:');
            this.validationResults.tests
                .filter(test => test.warning)
                .forEach(test => {
                    console.log(`  ⚠ ${test.name}: ${test.message}`);
                });
        }

        console.log('='.repeat(60));

        // 詳細レポートをファイルに保存
        this.saveDetailedReport();
    }

    /**
     * 詳細レポートの保存
     */
    async saveDetailedReport() {
        try {
            const reportDir = path.join(__dirname, 'reports');
            await fs.mkdir(reportDir, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const reportFile = path.join(reportDir, `validation-report-${timestamp}.json`);
            
            const report = {
                timestamp: new Date().toISOString(),
                summary: {
                    total: this.validationResults.tests.length,
                    passed: this.validationResults.passed,
                    failed: this.validationResults.failed,
                    warnings: this.validationResults.warnings
                },
                tests: this.validationResults.tests,
                environment: {
                    table_name: this.tableName,
                    aws_region: process.env.AWS_REGION || 'ap-northeast-1',
                    node_version: process.version
                }
            };
            
            await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
            log.success(`Detailed report saved: ${reportFile}`);
            
        } catch (error) {
            log.warning(`Failed to save detailed report: ${error.message}`);
        }
    }
}

// CLI実行
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
GitHub Analyzer Migration Validation Script

Usage: node validate-migration.js [options]

Options:
  --table-name TABLE_NAME    DynamoDB table name (default: from env DYNAMODB_TABLE_NAME)
  --region REGION           AWS region (default: from env AWS_REGION or ap-northeast-1)
  --help, -h                Show this help message

Environment Variables:
  DYNAMODB_TABLE_NAME       Target DynamoDB table name
  AWS_REGION               AWS region
  AWS_ACCESS_KEY_ID        AWS access key (if not using IAM roles)
  AWS_SECRET_ACCESS_KEY    AWS secret key (if not using IAM roles)

Examples:
  node validate-migration.js
  node validate-migration.js --table-name my-table --region us-east-1
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
        }
    }

    // 検証の実行
    const validator = new MigrationValidator();
    validator.validate().catch(error => {
        log.error(`Validation failed: ${error.message}`);
        if (process.env.NODE_ENV === 'development') {
            console.error(error.stack);
        }
        process.exit(1);
    });
}

module.exports = MigrationValidator;