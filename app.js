// --- Database Logic ---
const DB_NAME = 'KAKEI2_DB';
const DB_VERSION = 1;
const STORE_NAME = 'expenses';

let db;

async function requestPersist() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const isPersisted = await navigator.storage.persisted();
            if (!isPersisted) {
                const persisted = await navigator.storage.persist();
                console.log(`Storage persisted: ${persisted}`);
            } else {
                console.log('Storage is already persisted');
            }
        } catch (e) {
            console.error('Storage persist request failed:', e);
        }
    }
}

function initDB() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('groupTitle', 'groupTitle', { unique: false });
                }
            };
            request.onsuccess = async (e) => {
                db = e.target.result;
                await requestPersist();
                resolve(db);
            };
            request.onerror = (e) => {
                console.error('IndexedDB open error:', e);
                alert('データベースの起動に失敗しました。プライベートブラウズ等ではデータが保存されない場合があります。');
                reject(e);
            };
        } catch (err) {
            console.error('IndexedDB open thrown error:', err);
            reject(err);
        }
    });
}

function saveExpense(expense) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        try {
            const trans = db.transaction([STORE_NAME], 'readwrite');
            const store = trans.objectStore(STORE_NAME);
            store.add(expense);
            trans.oncomplete = () => resolve();
            trans.onerror = (e) => {
                console.error('Transaction error saving expense:', e);
                reject(e);
            };
        } catch (err) {
            console.error('Exception saving expense:', err);
            reject(err);
        }
    });
}

function getAllExpenses() {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve([]);
            return;
        }
        try {
            const trans = db.transaction([STORE_NAME], 'readonly');
            const store = trans.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => {
                console.error('Transaction error getting expenses:', e);
                reject(e);
            };
        } catch (err) {
            console.error('Exception getting expenses:', err);
            reject(err);
        }
    });
}

function clearAllData() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        try {
            const trans = db.transaction([STORE_NAME], 'readwrite');
            const store = trans.objectStore(STORE_NAME);
            store.clear();
            trans.oncomplete = () => resolve();
            trans.onerror = (e) => {
                console.error('Transaction error clearing data:', e);
                reject(e);
            };
        } catch (err) {
            console.error('Exception clearing data:', err);
            reject(err);
        }
    });
}

function clearGroupData(groupTitle) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        try {
            const trans = db.transaction([STORE_NAME], 'readwrite');
            const store = trans.objectStore(STORE_NAME);
            const index = store.index('groupTitle');
            const request = index.openCursor(IDBKeyRange.only(groupTitle));
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            trans.oncomplete = () => resolve();
            trans.onerror = (e) => {
                console.error('Transaction error clearing group data:', e);
                reject(e);
            };
        } catch (err) {
            console.error('Exception clearing group data:', err);
            reject(err);
        }
    });
}

// --- CSV行パースユーティリティ ---
function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());
    return fields;
}

// --- 未確定CSV Parsing Logic ---
// フォーマット: ご利用年月日, 利用店名, 支払区分, カード利用者区分, ご利用金額
function parseDraftCSV(text, groupTitle) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    
    const idxDate = headers.indexOf('ご利用年月日');
    const idxStore = headers.indexOf('利用店名');
    const idxType = headers.indexOf('支払区分');
    const idxUser = headers.indexOf('カード利用者区分');
    const idxAmount = headers.indexOf('ご利用金額');

    if (idxDate === -1 || idxAmount === -1) {
        alert('未確定CSVの必要な項目（ご利用年月日、ご利用金額など）が見つかりません。');
        return [];
    }

    const results = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCsvLine(line);
        if (fields.length <= Math.max(idxDate, idxAmount)) continue;

        const dateStr = fields[idxDate].replace(/^"|"$/g, '');
        const amountStr = fields[idxAmount].replace(/^"|"$/g, '').replace(/,/g, '');
        const amount = parseInt(amountStr, 10) || 0;

        results.push({
            date: dateStr,
            store: fields[idxStore] || '不明',
            type: fields[idxType] || '',
            user: fields[idxUser] || '',
            amount: amount,
            groupTitle: groupTitle
        });
    }
    return results;
}

// --- 確定CSV Parsing Logic ---
// フォーマット: D列(index 3)の2行目から: ご利用年月日, 利用店名, 支払い金額, 支払区分
function parseConfirmedCSV(text, groupTitle) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const results = [];
    // 3行目(index 2)からデータ開始
    for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCsvLine(line);

        // D列(index 3)からデータ: ご利用年月日, 利用店名, 支払い金額, 支払区分
        if (fields.length < 7) continue; // D列+4項目 = 最低7列必要

        const dateStr = (fields[3] || '').replace(/^"|"$/g, '');
        const storeStr = (fields[4] || '').replace(/^"|"$/g, '');
        const amountStr = (fields[5] || '').replace(/^"|"$/g, '').replace(/,/g, '');
        const typeStr = (fields[6] || '').replace(/^"|"$/g, '');

        if (!dateStr) continue;
        const amount = parseInt(amountStr, 10) || 0;

        results.push({
            date: dateStr,
            store: storeStr || '不明',
            type: typeStr || '',
            user: '',
            amount: amount,
            groupTitle: groupTitle
        });
    }
    return results;
}

// --- UI Logic ---
let currentGroup = localStorage.getItem('currentGroup') || '';
let currentSearchTerm = '';

// カテゴリ判定用の定義
const CATEGORY_COLORS = {
    'd払い': '#ff2d55',
    'eneos': '#ff9500',
    'amazon': '#5856d6',
    'ETC': '#34c759',
    'その他': '#8e8e93'
};

function categorizeExpense(storeName) {
    if (!storeName) return 'その他';
    const norm = storeName.normalize('NFKC').toLowerCase();
    
    if (norm.includes('d払い')) {
        return 'd払い';
    } else if (norm.includes('eneos') || norm.includes('エネオス')) {
        return 'eneos';
    } else if (norm.includes('amazon') || norm.includes('アマゾン')) {
        return 'amazon';
    } else if (norm.includes('etc')) {
        return 'ETC';
    } else {
        return 'その他';
    }
}

async function updateUI(searchTerm = '') {
    currentSearchTerm = searchTerm;
    const allExpenses = await getAllExpenses();
    
    // グループごとのタブを生成（月番号順にソート）
    const groupTitles = [...new Set(allExpenses.map(e => e.groupTitle))];
    groupTitles.sort((a, b) => {
        const numA = parseInt((a.match(/\d+/) || ['9999'])[0], 10);
        const numB = parseInt((b.match(/\d+/) || ['9999'])[0], 10);
        return numA - numB;
    });
    const tabsContainer = document.getElementById('monthTabs');
    tabsContainer.innerHTML = '';

    if (groupTitles.length === 0) {
        document.getElementById('expenseList').innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">データがありません</div>';
        document.getElementById('grandTotal').textContent = '0';
        document.getElementById('searchResultDisplay').classList.add('hidden');
        localStorage.removeItem('currentGroup');
        return;
    }

    if (!currentGroup || !groupTitles.includes(currentGroup)) {
        currentGroup = groupTitles[0];
        localStorage.setItem('currentGroup', currentGroup);
    }

    groupTitles.forEach(title => {
        const btn = document.createElement('button');
        btn.className = `tab ${title === currentGroup ? 'active' : ''}`;
        btn.textContent = title;
        btn.onclick = () => {
            currentGroup = title;
            localStorage.setItem('currentGroup', currentGroup);
            currentSearchTerm = '';
            document.getElementById('searchInput').value = '';
            updateUI();
        };
        tabsContainer.appendChild(btn);
    });

    // 明細リストの表示（選択中グループでフィルタ）
    let filtered = allExpenses.filter(e => e.groupTitle === currentGroup);
    
    // キーワード検索
    let searchTotal = 0;
    const isSearching = !!currentSearchTerm.trim();
    if (isSearching) {
        const term = currentSearchTerm.normalize('NFKC').toLowerCase();
        filtered = filtered.filter(item => {
            const target = `${item.store} ${item.type} ${item.user}`.normalize('NFKC').toLowerCase();
            const match = target.includes(term);
            if (match) searchTotal += item.amount;
            return match;
        });
        
        document.getElementById('searchResultDisplay').classList.remove('hidden');
        document.getElementById('searchTotal').textContent = `¥${searchTotal.toLocaleString()}`;
    } else {
        document.getElementById('searchResultDisplay').classList.add('hidden');
    }

    const listContainer = document.getElementById('expenseList');
    listContainer.innerHTML = '';

    let total = 0;
    filtered.forEach(item => {
        if (!isSearching) total += item.amount;
        const div = document.createElement('div');
        div.className = 'expense-item';
        div.innerHTML = `
            <div class="item-date">${item.date}</div>
            <div class="item-main">
                <span class="item-title">${item.store}</span>
                <span class="item-sub">${item.user ? item.user + ' | ' : ''}${item.type}</span>
            </div>
            <div class="item-amount">¥${item.amount.toLocaleString()}</div>
        `;
        listContainer.appendChild(div);
    });

    // 総合計は常にグループ全体の合計を表示
    if (!isSearching) {
        const groupAll = allExpenses.filter(e => e.groupTitle === currentGroup);
        total = groupAll.reduce((sum, e) => sum + e.amount, 0);
        document.getElementById('grandTotal').textContent = total.toLocaleString();
    }
}

// --- Analysis View Logic ---
function drawDonutChart(sums, total) {
    const canvas = document.getElementById('analysisChart');
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const size = 160; // 表示サイズを160pxに固定
    
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 10;

    ctx.clearRect(0, 0, size, size);

    if (total === 0) {
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#8e8e93';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('データがありません', centerX, centerY);
        return;
    }

    let startAngle = -Math.PI / 2;
    const categories = ['d払い', 'eneos', 'amazon', 'ETC', 'その他'];

    categories.forEach(cat => {
        const value = sums[cat];
        if (value === 0) return;

        const sliceAngle = (value / total) * Math.PI * 2;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
        ctx.closePath();

        ctx.fillStyle = CATEGORY_COLORS[cat];
        ctx.fill();

        startAngle += sliceAngle;
    });

    // 中央をくり抜いてドーナツ型にする
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // 通常のブレンドモードに戻す
    ctx.globalCompositeOperation = 'source-over';

    // 中央に合計額を表示
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#1e293b';
    ctx.font = 'bold 16px var(--font-family)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`¥${total.toLocaleString()}`, centerX, centerY);
}

function renderLegend(sums, total) {
    const legendContainer = document.getElementById('chartLegend');
    legendContainer.innerHTML = '';

    const categories = ['d払い', 'eneos', 'amazon', 'ETC', 'その他'];
    categories.forEach(cat => {
        const amount = sums[cat];
        const percent = total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0';

        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <div class="legend-left">
                <span class="legend-color" style="background-color: ${CATEGORY_COLORS[cat]}"></span>
                <span class="legend-name">${cat}</span>
            </div>
            <div class="legend-values">
                <span class="legend-amount">¥${amount.toLocaleString()}</span>
                <span class="legend-percent">${percent}%</span>
            </div>
        `;
        legendContainer.appendChild(item);
    });
}

function renderComparison(currentSums, previousSums, previousGroup) {
    const container = document.getElementById('comparisonList');
    container.innerHTML = '';

    if (!previousGroup) {
        container.innerHTML = `<div class="no-comparison">比較対象の先月データがありません</div>`;
        return;
    }

    const categories = ['d払い', 'eneos', 'amazon', 'ETC', 'その他'];
    categories.forEach(cat => {
        const curVal = currentSums[cat];
        const prevVal = previousSums[cat];
        const diff = curVal - prevVal;
        
        let changeText = '';
        let changeClass = 'text-same';
        
        if (diff > 0) {
            changeText = `+¥${diff.toLocaleString()}`;
            changeClass = 'text-up';
        } else if (diff < 0) {
            changeText = `-¥${Math.abs(diff).toLocaleString()}`;
            changeClass = 'text-down';
        } else {
            changeText = '±0';
            changeClass = 'text-same';
        }

        let percentText = '';
        if (prevVal > 0) {
            const pct = ((diff / prevVal) * 100).toFixed(1);
            percentText = pct > 0 ? `(+${pct}%)` : `(${pct}%)`;
        } else if (curVal > 0 && prevVal === 0) {
            percentText = '(新規)';
        }

        const div = document.createElement('div');
        div.className = 'comparison-item';
        div.innerHTML = `
            <div class="comp-category">
                <span class="comp-category-color" style="background-color: ${CATEGORY_COLORS[cat]}"></span>
                <span>${cat}</span>
            </div>
            <div>
                <span class="comp-val-label">先月 (${previousGroup})</span>
                <span class="comp-val-amount">¥${prevVal.toLocaleString()}</span>
            </div>
            <div>
                <span class="comp-val-label">今月 (${currentGroup})</span>
                <span class="comp-val-amount">¥${curVal.toLocaleString()}</span>
            </div>
            <div class="comp-change">
                <span class="comp-change-amount ${changeClass}">${changeText}</span>
                <span class="comp-change-percent ${changeClass}">${percentText}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

async function showAnalysis() {
    if (!currentGroup) return;

    document.getElementById('mainView').classList.add('hidden');
    document.getElementById('analysisView').classList.remove('hidden');
    document.getElementById('analysisTitle').textContent = `${currentGroup} 分析`;

    const allExpenses = await getAllExpenses();
    
    // グループソート
    const groupTitles = [...new Set(allExpenses.map(e => e.groupTitle))];
    groupTitles.sort((a, b) => {
        const numA = parseInt((a.match(/\d+/) || ['9999'])[0], 10);
        const numB = parseInt((b.match(/\d+/) || ['9999'])[0], 10);
        return numA - numB;
    });

    const currentData = allExpenses.filter(e => e.groupTitle === currentGroup);
    
    // 先月のグループのデータを取得 (ソートされたリストで1つ前)
    const currentIndex = groupTitles.indexOf(currentGroup);
    const previousGroup = currentIndex > 0 ? groupTitles[currentIndex - 1] : null;
    const previousData = previousGroup ? allExpenses.filter(e => e.groupTitle === previousGroup) : [];

    // 集計
    const currentSums = { 'd払い': 0, 'eneos': 0, 'amazon': 0, 'ETC': 0, 'その他': 0 };
    const previousSums = { 'd払い': 0, 'eneos': 0, 'amazon': 0, 'ETC': 0, 'その他': 0 };

    currentData.forEach(e => {
        const cat = categorizeExpense(e.store);
        currentSums[cat] += e.amount;
    });

    previousData.forEach(e => {
        const cat = categorizeExpense(e.store);
        previousSums[cat] += e.amount;
    });

    const totalAmount = currentData.reduce((sum, e) => sum + e.amount, 0);

    // チャート・凡例・比較レンダリング
    drawDonutChart(currentSums, totalAmount);
    renderLegend(currentSums, totalAmount);
    renderComparison(currentSums, previousSums, previousGroup);
}

function hideAnalysis() {
    document.getElementById('analysisView').classList.add('hidden');
    document.getElementById('mainView').classList.remove('hidden');
}

// --- Search Interaction ---
document.getElementById('searchBtn').addEventListener('click', () => {
    const term = document.getElementById('searchInput').value;
    updateUI(term);
});

document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const term = e.target.value;
        updateUI(term);
    }
});

document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    updateUI('');
});

// --- Import Interaction ---
let pendingFileContent = null;
let pendingImportType = 'draft'; // 'draft' or 'confirmed'
const titleModal = document.getElementById('titleModal');
const batchTitleInput = document.getElementById('batchTitleInput');

function decodeFileContent(arrayBuffer) {
    const decoder = new TextDecoder('shift-jis');
    let text = decoder.decode(arrayBuffer);
    if (!text.includes('ご利用') && !text.includes('年月日')) {
        text = new TextDecoder('utf-8').decode(arrayBuffer);
    }
    return text;
}

function handleFileSelect(e, importType) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        pendingFileContent = event.target.result;
        pendingImportType = importType;
        batchTitleInput.value = '';
        titleModal.classList.remove('hidden');
        batchTitleInput.focus();
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
}

document.getElementById('csvPickerDraft').addEventListener('change', (e) => {
    handleFileSelect(e, 'draft');
});

document.getElementById('csvPickerConfirmed').addEventListener('change', (e) => {
    handleFileSelect(e, 'confirmed');
});

document.getElementById('confirmImport').addEventListener('click', async () => {
    const title = batchTitleInput.value.trim();
    if (!title) {
        alert('名前を入力してください');
        return;
    }

    const text = decodeFileContent(pendingFileContent);

    let data;
    if (pendingImportType === 'confirmed') {
        data = parseConfirmedCSV(text, title);
    } else {
        data = parseDraftCSV(text, title);
    }

    await clearGroupData(title);

    for (const item of data) {
        await saveExpense(item);
    }

    titleModal.classList.add('hidden');
    pendingFileContent = null;
    currentGroup = title;
    localStorage.setItem('currentGroup', currentGroup);
    updateUI();
});

document.getElementById('cancelImport').addEventListener('click', () => {
    titleModal.classList.add('hidden');
    pendingFileContent = null;
});

document.getElementById('clearData').addEventListener('click', async () => {
    if (!currentGroup) return;
    if (confirm(`「${currentGroup}」のデータを消去しますか？`)) {
        await clearGroupData(currentGroup);
        currentGroup = '';
        localStorage.removeItem('currentGroup');
        updateUI();
    }
});

// --- Navigation & Total Tap ---
document.getElementById('totalCard').addEventListener('click', () => {
    showAnalysis();
});

document.getElementById('backBtn').addEventListener('click', () => {
    hideAnalysis();
});

// --- Theme Logic ---
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
    } else {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
    }
}

themeToggle.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    
    // 分析画面表示中の場合は円グラフをテーマ色に合わせて再描画
    if (!document.getElementById('analysisView').classList.contains('hidden')) {
        showAnalysis();
    }
});

// Initialize
window.addEventListener('load', async () => {
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(savedTheme);

    try {
        await initDB();
        await updateUI();
    } catch (e) {
        console.error('Initialization error:', e);
    }
});

