/**
 * オートコンプリート機能付き入力フィールドコンポーネント
 */
class AutocompleteInput {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.options = {
            placeholder: options.placeholder || 'Type to search...',
            separator: options.separator || ',',
            noResultsText: options.noResultsText || 'No results found',
            maxSuggestions: options.maxSuggestions || 10,
            minChars: options.minChars || 1,
            caseSensitive: options.caseSensitive || false,
            allowDuplicates: options.allowDuplicates || false,
            ...options
        };
        
        this.container = null;
        this.input = null;
        this.suggestionsList = null;
        this.suggestions = [];
        this.selectedValues = new Set();
        this.currentFocus = -1;
        this.isOpen = false;
        
        this.init();
    }
    
    /**
     * 初期化
     */
    init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container with id "${this.containerId}" not found`);
            return;
        }
        
        this.render();
        this.setupEventListeners();
    }
    
    /**
     * コンポーネントをレンダリング
     */
    render() {
        this.container.innerHTML = `
            <div class="autocomplete-container">
                <div class="autocomplete-input-wrapper">
                    <div class="autocomplete-tags"></div>
                    <input type="text" class="autocomplete-input" placeholder="${this.options.placeholder}">
                </div>
                <div class="autocomplete-suggestions" style="display: none;"></div>
            </div>
        `;
        
        this.inputWrapper = this.container.querySelector('.autocomplete-input-wrapper');
        this.input = this.container.querySelector('.autocomplete-input');
        this.tagsContainer = this.container.querySelector('.autocomplete-tags');
        this.suggestionsList = this.container.querySelector('.autocomplete-suggestions');
    }
    
    /**
     * イベントリスナーを設定
     */
    setupEventListeners() {
        // 入力イベント
        this.input.addEventListener('input', (e) => {
            this.handleInput(e.target.value);
        });
        
        // キーボードナビゲーション
        this.input.addEventListener('keydown', (e) => {
            this.handleKeydown(e);
        });
        
        // フォーカス/ブラー
        this.input.addEventListener('focus', () => {
            if (this.input.value.length >= this.options.minChars) {
                this.showSuggestions();
            }
        });
        
        this.input.addEventListener('blur', (e) => {
            // 遅延してブラーを処理（提案をクリックする時間を確保）
            setTimeout(() => {
                if (!this.container.contains(document.activeElement)) {
                    this.hideSuggestions();
                }
            }, 150);
        });
        
        // 外部クリックで閉じる
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.hideSuggestions();
            }
        });
        
        // 入力ラッパーをクリックしたときに入力にフォーカス
        this.inputWrapper.addEventListener('click', () => {
            this.input.focus();
        });
    }
    
    /**
     * 入力処理
     * @param {string} value - 入力値
     */
    handleInput(value) {
        const trimmedValue = value.trim();
        
        // セパレーターでの区切り処理
        if (value.includes(this.options.separator)) {
            const parts = value.split(this.options.separator);
            const lastPart = parts.pop().trim();
            
            // セパレーター前の部分を追加
            parts.forEach(part => {
                const trimmedPart = part.trim();
                if (trimmedPart) {
                    this.addValue(trimmedPart);
                }
            });
            
            // 最後の部分を入力フィールドに残す
            this.input.value = lastPart;
            this.handleInput(lastPart);
            return;
        }
        
        if (trimmedValue.length >= this.options.minChars) {
            this.filterSuggestions(trimmedValue);
            this.showSuggestions();
        } else {
            this.hideSuggestions();
        }
        
        this.currentFocus = -1;
    }
    
    /**
     * キーボード処理
     * @param {KeyboardEvent} e - キーボードイベント
     */
    handleKeydown(e) {
        const suggestions = this.suggestionsList.querySelectorAll('.autocomplete-suggestion:not(.disabled)');
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.currentFocus = Math.min(this.currentFocus + 1, suggestions.length - 1);
                this.updateFocus(suggestions);
                break;
                
            case 'ArrowUp':
                e.preventDefault();
                this.currentFocus = Math.max(this.currentFocus - 1, -1);
                this.updateFocus(suggestions);
                break;
                
            case 'Enter':
                e.preventDefault();
                if (this.currentFocus >= 0 && suggestions[this.currentFocus]) {
                    this.selectSuggestion(suggestions[this.currentFocus].textContent);
                } else if (this.input.value.trim()) {
                    this.addValue(this.input.value.trim());
                }
                break;
                
            case 'Escape':
                this.hideSuggestions();
                this.input.blur();
                break;
                
            case 'Backspace':
                if (!this.input.value && this.selectedValues.size > 0) {
                    // 入力が空でタグがある場合、最後のタグを削除
                    const values = Array.from(this.selectedValues);
                    this.removeValue(values[values.length - 1]);
                }
                break;
        }
    }
    
    /**
     * フォーカス更新
     * @param {NodeList} suggestions - 提案要素リスト
     */
    updateFocus(suggestions) {
        suggestions.forEach((suggestion, index) => {
            if (index === this.currentFocus) {
                suggestion.classList.add('focused');
            } else {
                suggestion.classList.remove('focused');
            }
        });
    }
    
    /**
     * 提案をフィルタリング
     * @param {string} query - 検索クエリ
     */
    filterSuggestions(query) {
        const searchQuery = this.options.caseSensitive ? query : query.toLowerCase();
        
        const filtered = this.suggestions.filter(suggestion => {
            const suggestionText = this.options.caseSensitive ? suggestion : suggestion.toLowerCase();
            const isMatch = suggestionText.includes(searchQuery);
            const isAlreadySelected = this.selectedValues.has(suggestion);
            
            return isMatch && (!isAlreadySelected || this.options.allowDuplicates);
        });
        
        this.renderSuggestions(filtered.slice(0, this.options.maxSuggestions));
    }
    
    /**
     * 提案をレンダリング
     * @param {Array} filteredSuggestions - フィルタリングされた提案
     */
    renderSuggestions(filteredSuggestions) {
        if (filteredSuggestions.length === 0) {
            this.suggestionsList.innerHTML = `
                <div class="autocomplete-no-results">${this.options.noResultsText}</div>
            `;
        } else {
            const html = filteredSuggestions.map(suggestion => `
                <div class="autocomplete-suggestion" data-value="${suggestion}">
                    ${this.highlightMatch(suggestion)}
                </div>
            `).join('');
            
            this.suggestionsList.innerHTML = html;
            
            // 提案のクリックイベント
            this.suggestionsList.querySelectorAll('.autocomplete-suggestion').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectSuggestion(item.dataset.value);
                });
            });
        }
    }
    
    /**
     * マッチした部分をハイライト
     * @param {string} text - テキスト
     * @returns {string} ハイライト済みHTML
     */
    highlightMatch(text) {
        const query = this.input.value.trim();
        if (!query) return text;
        
        const regex = new RegExp(`(${query})`, this.options.caseSensitive ? 'g' : 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }
    
    /**
     * 提案を選択
     * @param {string} value - 選択された値
     */
    selectSuggestion(value) {
        this.addValue(value);
        this.hideSuggestions();
    }
    
    /**
     * 値を追加
     * @param {string} value - 追加する値
     */
    addValue(value) {
        const trimmedValue = value.trim();
        if (!trimmedValue) return;
        
        if (!this.options.allowDuplicates && this.selectedValues.has(trimmedValue)) {
            this.input.value = '';
            return;
        }
        
        this.selectedValues.add(trimmedValue);
        this.input.value = '';
        this.renderTags();
        this.hideSuggestions();
        this.triggerChange();
    }
    
    /**
     * 値を削除
     * @param {string} value - 削除する値
     */
    removeValue(value) {
        this.selectedValues.delete(value);
        this.renderTags();
        this.triggerChange();
    }
    
    /**
     * タグをレンダリング
     */
    renderTags() {
        const html = Array.from(this.selectedValues).map(value => `
            <div class="autocomplete-tag">
                <span class="autocomplete-tag-text">${value}</span>
                <button class="autocomplete-tag-remove" data-value="${value}">×</button>
            </div>
        `).join('');
        
        this.tagsContainer.innerHTML = html;
        
        // 削除ボタンのイベント
        this.tagsContainer.querySelectorAll('.autocomplete-tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeValue(btn.dataset.value);
            });
        });
        
        // プレースホルダーの表示制御
        if (this.selectedValues.size > 0) {
            this.input.placeholder = '';
        } else {
            this.input.placeholder = this.options.placeholder;
        }
    }
    
    /**
     * 提案を表示
     */
    showSuggestions() {
        this.suggestionsList.style.display = 'block';
        this.isOpen = true;
        this.container.classList.add('open');
    }
    
    /**
     * 提案を非表示
     */
    hideSuggestions() {
        this.suggestionsList.style.display = 'none';
        this.isOpen = false;
        this.container.classList.remove('open');
        this.currentFocus = -1;
    }
    
    /**
     * 提案リストを設定
     * @param {Array} suggestions - 提案の配列
     */
    setSuggestions(suggestions) {
        this.suggestions = [...suggestions];
    }
    
    /**
     * 選択された値を取得
     * @returns {Array} 選択された値の配列
     */
    getValues() {
        return Array.from(this.selectedValues);
    }
    
    /**
     * 値を設定
     * @param {Array|string} values - 設定する値
     */
    setValues(values) {
        if (typeof values === 'string') {
            values = values.split(this.options.separator).map(v => v.trim()).filter(v => v);
        }
        
        this.selectedValues = new Set(values);
        this.renderTags();
        this.triggerChange();
    }
    
    /**
     * 値をクリア
     */
    clear() {
        this.selectedValues.clear();
        this.input.value = '';
        this.renderTags();
        this.hideSuggestions();
        this.triggerChange();
    }
    
    /**
     * 変更イベントをトリガー
     */
    triggerChange() {
        const event = new CustomEvent('change', {
            detail: {
                values: this.getValues()
            }
        });
        this.container.dispatchEvent(event);
    }
    
    /**
     * フォーカス
     */
    focus() {
        this.input.focus();
    }
    
    /**
     * 無効化
     */
    disable() {
        this.input.disabled = true;
        this.container.classList.add('disabled');
    }
    
    /**
     * 有効化
     */
    enable() {
        this.input.disabled = false;
        this.container.classList.remove('disabled');
    }
}