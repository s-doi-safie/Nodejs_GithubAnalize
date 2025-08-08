const zlib = require('zlib');
const { promisify } = require('util');
const { logger } = require('../services/s3-logger');

// zlib関数の非同期化
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * データ圧縮・展開ユーティリティ
 * DynamoDBに保存するデータを圧縮してストレージコストを削減
 */
class DataCompressor {
    constructor() {
        // 圧縮設定
        this.compressionOptions = {
            level: zlib.constants.Z_BEST_COMPRESSION, // 最高圧縮率
            windowBits: 15,
            memLevel: 8
        };
        
        // 圧縮対象の最小サイズ（バイト）
        this.minCompressionSize = 1024; // 1KB未満は圧縮しない
        
        // 圧縮統計
        this.stats = {
            compressed: 0,
            decompressed: 0,
            totalOriginalSize: 0,
            totalCompressedSize: 0
        };
    }

    /**
     * データを圧縮
     */
    async compress(data, forceCompress = false) {
        try {
            if (!data) {
                return { compressed: false, data: null };
            }

            // データをJSON文字列に変換
            const jsonString = JSON.stringify(data);
            const originalSize = Buffer.byteLength(jsonString, 'utf8');

            // 小さなデータは圧縮しない（圧縮オーバーヘッドを避ける）
            if (!forceCompress && originalSize < this.minCompressionSize) {
                logger.debug('Skipping compression for small data', { size: originalSize });
                return {
                    compressed: false,
                    data: data,
                    originalSize: originalSize,
                    compressedSize: originalSize,
                    compressionRatio: 1.0
                };
            }

            // データを圧縮
            const compressed = await gzip(jsonString, this.compressionOptions);
            const compressedSize = compressed.length;
            const compressionRatio = originalSize / compressedSize;

            // 圧縮効果が薄い場合は元データを返す
            if (!forceCompress && compressionRatio < 1.2) {
                logger.debug('Poor compression ratio, using original data', { 
                    ratio: compressionRatio.toFixed(2) 
                });
                return {
                    compressed: false,
                    data: data,
                    originalSize: originalSize,
                    compressedSize: originalSize,
                    compressionRatio: 1.0
                };
            }

            // 統計更新
            this.stats.compressed++;
            this.stats.totalOriginalSize += originalSize;
            this.stats.totalCompressedSize += compressedSize;

            logger.debug('Data compressed successfully', {
                originalSize,
                compressedSize,
                compressionRatio: compressionRatio.toFixed(2),
                reduction: ((originalSize - compressedSize) / originalSize * 100).toFixed(1) + '%'
            });

            return {
                compressed: true,
                data: compressed.toString('base64'), // Base64エンコードでDynamoDBに保存
                originalSize: originalSize,
                compressedSize: compressedSize,
                compressionRatio: compressionRatio,
                compressionTimestamp: new Date().toISOString()
            };

        } catch (error) {
            logger.error(error, { context: 'DataCompressor.compress' });
            // エラー時は元データを返す
            return {
                compressed: false,
                data: data,
                error: error.message
            };
        }
    }

    /**
     * データを展開
     */
    async decompress(compressedData) {
        try {
            if (!compressedData) {
                return null;
            }

            // 圧縮されていないデータの場合はそのまま返す
            if (!compressedData.compressed) {
                return compressedData.data;
            }

            // Base64デコード
            const compressedBuffer = Buffer.from(compressedData.data, 'base64');
            
            // データを展開
            const decompressed = await gunzip(compressedBuffer);
            const jsonString = decompressed.toString('utf8');
            const originalData = JSON.parse(jsonString);

            // 統計更新
            this.stats.decompressed++;

            logger.debug('Data decompressed successfully', {
                compressedSize: compressedBuffer.length,
                decompressedSize: decompressed.length
            });

            return originalData;

        } catch (error) {
            logger.error(error, { context: 'DataCompressor.decompress' });
            
            // 展開エラーの場合、元データがそのまま保存されている可能性を確認
            if (typeof compressedData.data === 'object') {
                logger.warn('Fallback to uncompressed data due to decompression error');
                return compressedData.data;
            }
            
            throw error;
        }
    }

    /**
     * 大きなオブジェクトの選択的圧縮
     */
    async compressLargeFields(data, fieldsToCompress = []) {
        try {
            if (!data || typeof data !== 'object') {
                return data;
            }

            const compressedData = { ...data };
            let hasCompressedFields = false;

            for (const field of fieldsToCompress) {
                if (data[field] && typeof data[field] === 'object') {
                    const fieldData = data[field];
                    const fieldSize = Buffer.byteLength(JSON.stringify(fieldData), 'utf8');
                    
                    // 大きなフィールドのみ圧縮
                    if (fieldSize > this.minCompressionSize) {
                        const compressed = await this.compress(fieldData, true);
                        if (compressed.compressed) {
                            compressedData[field] = {
                                __compressed: true,
                                ...compressed
                            };
                            hasCompressedFields = true;
                            
                            logger.info(`Field ${field} compressed`, {
                                originalSize: compressed.originalSize,
                                compressedSize: compressed.compressedSize,
                                reduction: ((compressed.originalSize - compressed.compressedSize) / compressed.originalSize * 100).toFixed(1) + '%'
                            });
                        }
                    }
                }
            }

            return {
                ...compressedData,
                __hasCompressedFields: hasCompressedFields
            };

        } catch (error) {
            logger.error(error, { context: 'DataCompressor.compressLargeFields' });
            return data;
        }
    }

    /**
     * 選択的に圧縮されたフィールドの展開
     */
    async decompressLargeFields(data, fieldsToDecompress = []) {
        try {
            if (!data || typeof data !== 'object' || !data.__hasCompressedFields) {
                return data;
            }

            const decompressedData = { ...data };
            delete decompressedData.__hasCompressedFields;

            for (const field of fieldsToDecompress) {
                if (data[field] && data[field].__compressed) {
                    const fieldData = await this.decompress(data[field]);
                    decompressedData[field] = fieldData;
                }
            }

            return decompressedData;

        } catch (error) {
            logger.error(error, { context: 'DataCompressor.decompressLargeFields' });
            return data;
        }
    }

    /**
     * 圧縮統計を取得
     */
    getStats() {
        const totalCompressionRatio = this.stats.totalOriginalSize > 0 
            ? this.stats.totalOriginalSize / this.stats.totalCompressedSize 
            : 1.0;
            
        const totalSavings = this.stats.totalOriginalSize - this.stats.totalCompressedSize;
        const savingsPercentage = this.stats.totalOriginalSize > 0
            ? (totalSavings / this.stats.totalOriginalSize * 100)
            : 0;

        return {
            compressed: this.stats.compressed,
            decompressed: this.stats.decompressed,
            totalOriginalSize: this.stats.totalOriginalSize,
            totalCompressedSize: this.stats.totalCompressedSize,
            totalCompressionRatio: totalCompressionRatio.toFixed(2),
            totalSavingsBytes: totalSavings,
            totalSavingsPercentage: savingsPercentage.toFixed(1) + '%',
            averageCompressionRatio: this.stats.compressed > 0 
                ? (totalCompressionRatio).toFixed(2)
                : '0.00'
        };
    }

    /**
     * 圧縮統計をリセット
     */
    resetStats() {
        this.stats = {
            compressed: 0,
            decompressed: 0,
            totalOriginalSize: 0,
            totalCompressedSize: 0
        };
    }
}

// シングルトンインスタンス
let compressorInstance;

function getCompressor() {
    if (!compressorInstance) {
        compressorInstance = new DataCompressor();
    }
    return compressorInstance;
}

module.exports = {
    DataCompressor,
    getCompressor
};