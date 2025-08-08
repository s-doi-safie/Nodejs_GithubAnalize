/**
 * Lambda内メモリキャッシュマネージャー
 * LRU方式でAPIレスポンスをキャッシュ
 */
class CacheManager {
    constructor(maxSize = 100 * 1024 * 1024) { // 100MB
        this.cache = new Map();
        this.maxSize = maxSize;
        this.currentSize = 0;
        this.hitCount = 0;
        this.missCount = 0;
        this.defaultTTL = 300000; // 5分
    }

    /**
     * キャッシュキーの生成
     */
    generateKey(type, params = {}) {
        const sortedParams = Object.keys(params)
            .sort()
            .reduce((acc, key) => {
                acc[key] = params[key];
                return acc;
            }, {});
        
        return `${type}:${JSON.stringify(sortedParams)}`;
    }

    /**
     * キャッシュから取得
     */
    get(key) {
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.missCount++;
            return null;
        }
        
        // TTLチェック
        if (entry.expiresAt < Date.now()) {
            this.delete(key);
            this.missCount++;
            return null;
        }
        
        // LRU: 最近使用したものを最後に移動
        this.cache.delete(key);
        this.cache.set(key, entry);
        
        this.hitCount++;
        return entry.data;
    }

    /**
     * キャッシュに保存
     */
    set(key, data, ttl = this.defaultTTL) {
        const dataStr = JSON.stringify(data);
        const dataSize = Buffer.byteLength(dataStr, 'utf8');
        
        // サイズ制限チェック
        if (dataSize > this.maxSize) {
            return false;
        }
        
        // 既存エントリがある場合は削除
        if (this.cache.has(key)) {
            this.delete(key);
        }
        
        // 容量確保（LRU削除）
        while (this.currentSize + dataSize > this.maxSize && this.cache.size > 0) {
            const firstKey = this.cache.keys().next().value;
            this.delete(firstKey);
        }
        
        // 新規エントリ追加
        const entry = {
            data,
            size: dataSize,
            expiresAt: Date.now() + ttl,
            createdAt: Date.now()
        };
        
        this.cache.set(key, entry);
        this.currentSize += dataSize;
        
        return true;
    }

    /**
     * キャッシュから削除
     */
    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            this.currentSize -= entry.size;
            this.cache.delete(key);
            return true;
        }
        return false;
    }

    /**
     * キャッシュをクリア
     */
    clear() {
        this.cache.clear();
        this.currentSize = 0;
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * 期限切れエントリの削除
     */
    evictExpired() {
        const now = Date.now();
        const keysToDelete = [];
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt < now) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.delete(key));
        
        return keysToDelete.length;
    }

    /**
     * キャッシュ統計
     */
    getStats() {
        const totalRequests = this.hitCount + this.missCount;
        const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;
        
        return {
            size: this.cache.size,
            currentSize: this.currentSize,
            maxSize: this.maxSize,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate: hitRate.toFixed(2) + '%',
            utilization: ((this.currentSize / this.maxSize) * 100).toFixed(2) + '%'
        };
    }

    /**
     * 関数の結果をキャッシュするデコレータ
     */
    async cached(key, fn, ttl = this.defaultTTL) {
        // キャッシュチェック
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }
        
        // 関数実行
        const result = await fn();
        
        // 結果をキャッシュ
        this.set(key, result, ttl);
        
        return result;
    }

    /**
     * APIレスポンス専用キャッシュ
     */
    async cacheApiResponse(endpoint, params, fetchFn, ttl) {
        const key = this.generateKey(endpoint, params);
        return this.cached(key, fetchFn, ttl);
    }

    /**
     * バッチキャッシュ取得
     */
    getMany(keys) {
        const results = {};
        const missingKeys = [];
        
        for (const key of keys) {
            const value = this.get(key);
            if (value !== null) {
                results[key] = value;
            } else {
                missingKeys.push(key);
            }
        }
        
        return { results, missingKeys };
    }

    /**
     * バッチキャッシュ設定
     */
    setMany(entries, ttl = this.defaultTTL) {
        const results = {};
        
        for (const [key, value] of Object.entries(entries)) {
            results[key] = this.set(key, value, ttl);
        }
        
        return results;
    }

    /**
     * 部分キーマッチで削除
     */
    deletePattern(pattern) {
        const keysToDelete = [];
        const regex = new RegExp(pattern);
        
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                keysToDelete.push(key);
            }
        }
        
        keysToDelete.forEach(key => this.delete(key));
        
        return keysToDelete.length;
    }
}

// シングルトンインスタンス
let cacheInstance;

function getCache() {
    if (!cacheInstance) {
        cacheInstance = new CacheManager();
    }
    return cacheInstance;
}

// エクスポート
module.exports = {
    CacheManager,
    getCache
};