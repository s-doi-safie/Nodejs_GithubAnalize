const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { gzipSync } = require('zlib');

/**
 * S3ログシステム
 * CloudWatchの代わりにS3へ直接ログを出力
 */
class S3Logger {
    constructor() {
        this.s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
        this.bucketName = process.env.LOG_BUCKET_NAME || `github-analyzer-logs-${process.env.ENVIRONMENT || 'dev'}`;
        this.logBuffer = [];
        this.errorBuffer = [];
        this.metricsBuffer = [];
        this.lastFlush = Date.now();
        this.flushInterval = 10000; // 10秒
        this.maxBufferSize = 100;
        
        // 定期フラッシュの設定
        if (typeof setInterval !== 'undefined') {
            setInterval(() => this.flushAll(), this.flushInterval);
        }
    }

    /**
     * 通常ログの記録
     */
    log(level, message, metadata = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...metadata,
            requestId: process.env._X_AMZN_TRACE_ID || '',
            environment: process.env.ENVIRONMENT || 'dev'
        };

        this.logBuffer.push(JSON.stringify(logEntry));
        
        if (this.logBuffer.length >= this.maxBufferSize) {
            this.flushLogs();
        }
    }

    /**
     * エラーログの記録
     */
    error(error, context = {}) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            message: error.message || String(error),
            stack: error.stack,
            ...context,
            requestId: process.env._X_AMZN_TRACE_ID || '',
            environment: process.env.ENVIRONMENT || 'dev'
        };

        this.errorBuffer.push(JSON.stringify(errorEntry));
        
        if (this.errorBuffer.length >= this.maxBufferSize) {
            this.flushErrors();
        }
    }

    /**
     * メトリクスの記録
     */
    metric(name, value, unit = 'Count', metadata = {}) {
        const metricEntry = {
            timestamp: new Date().toISOString(),
            metric: name,
            value,
            unit,
            ...metadata,
            environment: process.env.ENVIRONMENT || 'dev'
        };

        this.metricsBuffer.push(JSON.stringify(metricEntry));
        
        if (this.metricsBuffer.length >= this.maxBufferSize) {
            this.flushMetrics();
        }
    }

    /**
     * アクセスログの記録
     */
    access(request, response, duration) {
        const accessEntry = {
            timestamp: new Date().toISOString(),
            method: request.httpMethod,
            path: request.path,
            statusCode: response.statusCode,
            duration,
            ip: request.headers?.['X-Forwarded-For'] || request.headers?.['x-forwarded-for'],
            userAgent: request.headers?.['User-Agent'] || request.headers?.['user-agent'],
            requestId: process.env._X_AMZN_TRACE_ID || '',
            environment: process.env.ENVIRONMENT || 'dev'
        };

        this.log('ACCESS', `${accessEntry.method} ${accessEntry.path} ${accessEntry.statusCode}`, accessEntry);
    }

    /**
     * ログバッファをS3にフラッシュ
     */
    async flushLogs() {
        if (this.logBuffer.length === 0) return;
        
        const logs = this.logBuffer.splice(0);
        await this.writeToS3('access', logs);
    }

    /**
     * エラーバッファをS3にフラッシュ
     */
    async flushErrors() {
        if (this.errorBuffer.length === 0) return;
        
        const errors = this.errorBuffer.splice(0);
        await this.writeToS3('error', errors);
    }

    /**
     * メトリクスバッファをS3にフラッシュ
     */
    async flushMetrics() {
        if (this.metricsBuffer.length === 0) return;
        
        const metrics = this.metricsBuffer.splice(0);
        await this.writeToS3('metrics', metrics);
    }

    /**
     * 全バッファをフラッシュ
     */
    async flushAll() {
        await Promise.all([
            this.flushLogs(),
            this.flushErrors(),
            this.flushMetrics()
        ]);
    }

    /**
     * S3への書き込み
     */
    async writeToS3(type, entries) {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const timestamp = now.getTime();
            
            // JSON Lines形式でデータを結合
            const jsonLines = entries.join('\n') + '\n';
            
            // Gzip圧縮
            const compressed = gzipSync(Buffer.from(jsonLines, 'utf-8'));
            
            // S3キー
            const key = `${year}/${month}/${day}/${type}-${hour}-${timestamp}.jsonl.gz`;
            
            // S3への保存
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: compressed,
                ContentType: 'application/x-gzip',
                ContentEncoding: 'gzip',
                Metadata: {
                    'log-type': type,
                    'entry-count': String(entries.length),
                    'environment': process.env.ENVIRONMENT || 'dev'
                }
            });
            
            await this.s3Client.send(command);
            
        } catch (error) {
            // S3書き込みエラーは無視（ログの損失を防ぐため）
            // 本番環境では別の方法で通知することを検討
        }
    }

    /**
     * Lambda終了時の処理
     */
    async shutdown() {
        await this.flushAll();
    }
}

// シングルトンインスタンス
let loggerInstance;

function getLogger() {
    if (!loggerInstance) {
        loggerInstance = new S3Logger();
    }
    return loggerInstance;
}

// 便利なヘルパー関数
const logger = {
    info: (message, metadata) => getLogger().log('INFO', message, metadata),
    warn: (message, metadata) => getLogger().log('WARN', message, metadata),
    error: (error, context) => getLogger().error(error, context),
    debug: (message, metadata) => getLogger().log('DEBUG', message, metadata),
    metric: (name, value, unit, metadata) => getLogger().metric(name, value, unit, metadata),
    access: (request, response, duration) => getLogger().access(request, response, duration),
    flush: () => getLogger().flushAll(),
    shutdown: () => getLogger().shutdown()
};

module.exports = { S3Logger, getLogger, logger };