/**
 * マルチセレクトドロップダウンコンポーネント
 */
class MultiSelectDropdown {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.options = {
            placeholder: options.placeholder || 'Select items...',
            searchPlaceholder: options.searchPlaceholder || 'Search...',
            selectAllText: options.selectAllText || 'Select All',
            deselectAllText: options.deselectAllText || 'Deselect All',
            noResultsText: options.noResultsText || 'No results found',
            selectedText: options.selectedText || 'selected',
            ...options
        };
        
        this.container = null;
        this.selectedItems = new Set();
        this.items = [];
        this.isOpen = false;
        this.searchTerm = '';
        
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
            <div class="multi-select-dropdown">
                <div class="multi-select-header">
                    <div class="multi-select-selected-display">
                        <span class="multi-select-placeholder">${this.options.placeholder}</span>
                        <span class="multi-select-selected-count" style="display: none;"></span>
                    </div>
                    <div class="multi-select-arrow">▼</div>
                </div>
                <div class="multi-select-dropdown-content" style="display: none;">
                    <div class="multi-select-search-container">
                        <input type="text" class="multi-select-search" placeholder="${this.options.searchPlaceholder}">
                    </div>
                    <div class="multi-select-actions">
                        <button class="multi-select-select-all">${this.options.selectAllText}</button>
                        <button class="multi-select-deselect-all">${this.options.deselectAllText}</button>
                    </div>
                    <div class="multi-select-items-container">
                        <div class="multi-select-items"></div>
                    </div>
                </div>
            </div>
        `;
        
        this.dropdown = this.container.querySelector('.multi-select-dropdown');
        this.header = this.container.querySelector('.multi-select-header');
        this.dropdownContent = this.container.querySelector('.multi-select-dropdown-content');
        this.itemsContainer = this.container.querySelector('.multi-select-items');
        this.searchInput = this.container.querySelector('.multi-select-search');
        this.selectedDisplay = this.container.querySelector('.multi-select-selected-display');
        this.placeholder = this.container.querySelector('.multi-select-placeholder');
        this.selectedCount = this.container.querySelector('.multi-select-selected-count');
    }
    
    /**
     * イベントリスナーを設定
     */
    setupEventListeners() {
        // ヘッダークリックでドロップダウンを開閉
        this.header.addEventListener('click', () => this.toggle());
        
        // 検索入力
        this.searchInput.addEventListener('input', (e) => {
            this.searchTerm = e.target.value.toLowerCase();
            this.renderItems();
        });
        
        // 全選択・全解除ボタン
        this.container.querySelector('.multi-select-select-all').addEventListener('click', () => {
            this.selectAll();
        });
        
        this.container.querySelector('.multi-select-deselect-all').addEventListener('click', () => {
            this.deselectAll();
        });
        
        // ドロップダウン外クリックで閉じる
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });
        
        // 検索入力のクリックイベントの伝播を停止
        this.searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    /**
     * アイテムを設定
     * @param {Array} items - アイテムの配列 [{value: string, label: string, group?: string}]
     */
    setItems(items) {
        this.items = items;
        this.renderItems();
    }
    
    /**
     * アイテムをレンダリング
     */
    renderItems() {
        const filteredItems = this.items.filter(item => 
            item.label.toLowerCase().includes(this.searchTerm) ||
            (item.group && item.group.toLowerCase().includes(this.searchTerm))
        );
        
        if (filteredItems.length === 0) {
            this.itemsContainer.innerHTML = `
                <div class="multi-select-no-results">${this.options.noResultsText}</div>
            `;
            return;
        }
        
        // グループごとにアイテムを整理
        const grouped = {};
        const noGroup = [];
        
        filteredItems.forEach(item => {
            if (item.group) {
                if (!grouped[item.group]) {
                    grouped[item.group] = [];
                }
                grouped[item.group].push(item);
            } else {
                noGroup.push(item);
            }
        });
        
        let html = '';
        
        // グループなしのアイテム
        noGroup.forEach(item => {
            const checked = this.selectedItems.has(item.value) ? 'checked' : '';
            html += `
                <div class="multi-select-item" data-value="${item.value}">
                    <input type="checkbox" id="ms-item-${item.value}" ${checked}>
                    <label for="ms-item-${item.value}">${item.label}</label>
                </div>
            `;
        });
        
        // グループありのアイテム
        Object.keys(grouped).sort().forEach(group => {
            html += `
                <div class="multi-select-group">
                    <div class="multi-select-group-header">${group}</div>
            `;
            
            grouped[group].forEach(item => {
                const checked = this.selectedItems.has(item.value) ? 'checked' : '';
                html += `
                    <div class="multi-select-item" data-value="${item.value}">
                        <input type="checkbox" id="ms-item-${item.value}" ${checked}>
                        <label for="ms-item-${item.value}">${item.label}</label>
                    </div>
                `;
            });
            
            html += '</div>';
        });
        
        this.itemsContainer.innerHTML = html;
        
        // チェックボックスのイベントリスナー
        this.itemsContainer.querySelectorAll('.multi-select-item input').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const value = e.target.closest('.multi-select-item').dataset.value;
                if (e.target.checked) {
                    this.selectedItems.add(value);
                } else {
                    this.selectedItems.delete(value);
                }
                this.updateSelectedDisplay();
                this.triggerChange();
            });
        });
    }
    
    /**
     * 選択状態の表示を更新
     */
    updateSelectedDisplay() {
        const count = this.selectedItems.size;
        
        if (count === 0) {
            this.placeholder.style.display = 'inline';
            this.selectedCount.style.display = 'none';
        } else {
            this.placeholder.style.display = 'none';
            this.selectedCount.style.display = 'inline';
            
            if (count === 1) {
                const selectedValue = Array.from(this.selectedItems)[0];
                const item = this.items.find(i => i.value === selectedValue);
                this.selectedCount.textContent = item ? item.label : selectedValue;
            } else {
                this.selectedCount.textContent = `${count} ${this.options.selectedText}`;
            }
        }
    }
    
    /**
     * ドロップダウンを開閉
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
    
    /**
     * ドロップダウンを開く
     */
    open() {
        this.dropdownContent.style.display = 'block';
        this.dropdown.classList.add('open');
        this.isOpen = true;
        this.searchInput.focus();
    }
    
    /**
     * ドロップダウンを閉じる
     */
    close() {
        this.dropdownContent.style.display = 'none';
        this.dropdown.classList.remove('open');
        this.isOpen = false;
        this.searchTerm = '';
        this.searchInput.value = '';
        this.renderItems();
    }
    
    /**
     * 全選択
     */
    selectAll() {
        const filteredItems = this.items.filter(item => 
            item.label.toLowerCase().includes(this.searchTerm) ||
            (item.group && item.group.toLowerCase().includes(this.searchTerm))
        );
        
        filteredItems.forEach(item => {
            this.selectedItems.add(item.value);
        });
        
        this.renderItems();
        this.updateSelectedDisplay();
        this.triggerChange();
    }
    
    /**
     * 全解除
     */
    deselectAll() {
        if (this.searchTerm) {
            // 検索中の場合は表示されているアイテムのみ解除
            const filteredItems = this.items.filter(item => 
                item.label.toLowerCase().includes(this.searchTerm) ||
                (item.group && item.group.toLowerCase().includes(this.searchTerm))
            );
            
            filteredItems.forEach(item => {
                this.selectedItems.delete(item.value);
            });
        } else {
            // 検索していない場合は全て解除
            this.selectedItems.clear();
        }
        
        this.renderItems();
        this.updateSelectedDisplay();
        this.triggerChange();
    }
    
    /**
     * 選択されたアイテムを取得
     * @returns {Array} 選択されたアイテムの値の配列
     */
    getSelected() {
        return Array.from(this.selectedItems);
    }
    
    /**
     * 選択状態を設定
     * @param {Array} values - 選択する値の配列
     */
    setSelected(values) {
        this.selectedItems = new Set(values);
        this.renderItems();
        this.updateSelectedDisplay();
    }
    
    /**
     * 変更イベントをトリガー
     */
    triggerChange() {
        const event = new CustomEvent('change', {
            detail: {
                selected: this.getSelected()
            }
        });
        this.container.dispatchEvent(event);
    }
    
    /**
     * コンポーネントを無効化
     */
    disable() {
        this.dropdown.classList.add('disabled');
        this.header.style.pointerEvents = 'none';
    }
    
    /**
     * コンポーネントを有効化
     */
    enable() {
        this.dropdown.classList.remove('disabled');
        this.header.style.pointerEvents = 'auto';
    }
}