/**
 * School Dashboard App (Google Calendar API Supported)
 */

// --- ⚙️ USER CONFIG (あなたの情報をここに入れてください) ---
const GCAL_CONFIG = {
    // Google Cloud Consoleで取得した「OAuth クライアントID」
    CLIENT_ID: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
    
    // Google Cloud Consoleで取得した「APIキー」
    API_KEY: 'YOUR_API_KEY_HERE',
    
    // 変更不要
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
    SCOPES: 'https://www.googleapis.com/auth/calendar.events.readonly' 
};
// -----------------------------------------------------------

const CONFIG = {
    classes: ['21HR', '22HR', '23HR', '24HR', '25HR', '26HR', '27HR', '28HR'],
    adminPin: '1234'
};

const DEFAULT_ADMIN_DATA = {
    timeSettings: [
        { period: 1, start: "08:50", end: "09:40" },
        { period: 2, start: "09:50", end: "10:40" },
        { period: 3, start: "10:50", end: "11:40" },
        { period: 4, start: "11:50", end: "12:40" },
        { period: 5, start: "13:30", end: "14:20" },
        { period: 6, start: "14:30", end: "15:20" },
        { period: 7, start: "15:30", end: "16:20" }
    ],
    tests: [],
    schedule: {}
};

// --- Data Manager (GitHub & LocalStorage) ---
class DataManager {
    constructor() {
        this.adminData = JSON.parse(JSON.stringify(DEFAULT_ADMIN_DATA));
        this.userData = this.loadUserData();
        this.githubConfig = this.loadGitHubConfig();
    }
    loadUserData() {
        const saved = localStorage.getItem('school_dash_user');
        return saved ? JSON.parse(saved) : { classId: '', todos: [] }; // iCalUrl削除
    }
    saveUserData() {
        localStorage.setItem('school_dash_user', JSON.stringify(this.userData));
    }
    async loadAdminData() {
        if (this.githubConfig.owner && this.githubConfig.repo && this.githubConfig.path) {
            try {
                const url = `https://raw.githubusercontent.com/${this.githubConfig.owner}/${this.githubConfig.repo}/main/${this.githubConfig.path}`;
                const res = await fetch(url + '?t=' + new Date().getTime());
                if (res.ok) { this.adminData = await res.json(); return; }
            } catch (e) { console.error('GitHub load failed', e); }
        }
        const local = localStorage.getItem('school_dash_admin_backup');
        if (local) this.adminData = JSON.parse(local);
    }
    async saveAdminDataToGitHub() {
        localStorage.setItem('school_dash_admin_backup', JSON.stringify(this.adminData));
        const { owner, repo, path, token } = this.githubConfig;
        if (!owner || !repo || !path || !token) return alert('GitHub設定が不完全です');
        
        try {
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
            const getRes = await fetch(apiUrl, { headers: { 'Authorization': `token ${token}` } });
            const sha = getRes.ok ? (await getRes.json()).sha : null;
            
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(this.adminData, null, 2))));
            const res = await fetch(apiUrl, {
                method: 'PUT',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: "Update via Admin", content, sha })
            });
            if (res.ok) alert('保存成功！'); else alert('エラー: ' + (await res.json()).message);
        } catch (e) { alert('通信エラー: ' + e.message); }
    }
    loadGitHubConfig() {
        const s = localStorage.getItem('school_dash_gh_config');
        return s ? JSON.parse(s) : { owner: '', repo: '', path: '', token: '' };
    }
    saveGitHubConfig(c) {
        this.githubConfig = c;
        localStorage.setItem('school_dash_gh_config', JSON.stringify(c));
    }
}

// --- Google Calendar Manager ---
class GCalManager {
    constructor() {
        this.tokenClient = null;
        this.gapiInited = false;
        this.gisInited = false;
        this.isAuthenticated = false;
    }

    // Load API Libraries
    init() {
        if(!GCAL_CONFIG.CLIENT_ID.includes('googleusercontent')) {
            console.warn('Google Client IDが未設定です');
            return;
        }
        
        // 1. Load gapi client
        gapi.load('client', async () => {
            await gapi.client.init({
                apiKey: GCAL_CONFIG.API_KEY,
                discoveryDocs: [GCAL_CONFIG.DISCOVERY_DOC],
            });
            this.gapiInited = true;
            this.checkAuth();
        });

        // 2. Load GIS client
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GCAL_CONFIG.CLIENT_ID,
            scope: GCAL_CONFIG.SCOPES,
            callback: async (resp) => {
                if (resp.error !== undefined) {
                    throw (resp);
                }
                this.isAuthenticated = true;
                this.updateUIState(true);
                await this.fetchEvents();
            },
        });
        this.gisInited = true;
    }

    handleAuthClick() {
        if (!this.gisInited) return;
        this.tokenClient.requestAccessToken({prompt: 'consent'});
    }

    handleSignoutClick() {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
            this.isAuthenticated = false;
            this.updateUIState(false);
            document.getElementById('gcalList').innerHTML = '';
        }
    }

    checkAuth() {
        // gapi keeps token in memory usually, this is a basic check
        if(gapi.client.getToken()) {
            this.isAuthenticated = true;
            this.updateUIState(true);
            this.fetchEvents();
        }
    }

    updateUIState(isLoggedIn) {
        // Dashboard
        const dashBtn = document.getElementById('gcalAuthBtnSmall');
        const dashMsg = document.getElementById('gcalStatusMsg');
        
        // Settings
        const loginBtn = document.getElementById('gcalLoginBtn');
        const logoutBtn = document.getElementById('gcalLogoutBtn');
        const statusTxt = document.getElementById('gcalAuthStatus');

        if (isLoggedIn) {
            dashBtn.style.display = 'none';
            dashMsg.style.display = 'none';
            loginBtn.style.display = 'none';
            logoutBtn.style.display = 'inline-block';
            statusTxt.textContent = "接続済み: 予定を取得中...";
            statusTxt.style.color = "green";
        } else {
            dashBtn.style.display = 'inline-block';
            dashMsg.style.display = 'block';
            dashMsg.textContent = 'ログインして予定を表示';
            loginBtn.style.display = 'flex';
            logoutBtn.style.display = 'none';
            statusTxt.textContent = "未接続";
            statusTxt.style.color = "#636E72";
        }
    }

    async fetchEvents() {
        if(!this.isAuthenticated) return;
        try {
            const request = {
                'calendarId': 'primary',
                'timeMin': (new Date()).toISOString(),
                'showDeleted': false,
                'singleEvents': true,
                'maxResults': 5,
                'orderBy': 'startTime'
            };
            const response = await gapi.client.calendar.events.list(request);
            const events = response.result.items;
            this.renderEvents(events);
            document.getElementById('gcalAuthStatus').textContent = "接続済み (同期完了)";
        } catch (err) {
            document.getElementById('gcalStatusMsg').textContent = '予定の取得に失敗しました';
            console.error(err);
        }
    }

    renderEvents(events) {
        const list = document.getElementById('gcalList');
        list.innerHTML = '';
        if (!events || events.length === 0) {
            document.getElementById('gcalStatusMsg').textContent = '予定はありません';
            document.getElementById('gcalStatusMsg').style.display = 'block';
            return;
        }
        
        document.getElementById('gcalStatusMsg').style.display = 'none';
        
        events.forEach(event => {
            const when = event.start.dateTime;
            const start = when ? new Date(when) : new Date(event.start.date); // datetime or date(all day)
            
            // Format time: "1/16 10:00"
            const dateStr = `${start.getMonth()+1}/${start.getDate()}`;
            const timeStr = event.start.dateTime 
                ? `${start.getHours().toString().padStart(2,'0')}:${start.getMinutes().toString().padStart(2,'0')}` 
                : '終日';

            const li = document.createElement('li');
            li.className = 'gcal-item';
            li.innerHTML = `
                <span class="gcal-time">${dateStr} ${timeStr}</span>
                <span class="gcal-summary">${event.summary}</span>
            `;
            list.appendChild(li);
        });
    }
}

// --- App Controller ---
const dataManager = new DataManager();
const gcalManager = new GCalManager();

const app = {
    init: async () => {
        await dataManager.loadAdminData();
        app.setupEventListeners();
        app.renderDashboard();
        
        // Timer
        setInterval(app.updateClock, 1000);
        app.updateClock();

        // Google Calendar Init (Wait for window load to ensure scripts are ready)
        // Note: The script tags in HTML are async, so we call init after window loads
    },

    navigate: (viewId) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        if (viewId === 'dashboard') {
            app.renderDashboard();
            gcalManager.fetchEvents(); // Refresh calendar on view
        }
    },

    setupEventListeners: () => {
        // Nav
        document.getElementById('userSettingsBtn').onclick = () => app.navigate('settings');
        document.getElementById('adminLoginBtn').onclick = () => app.navigate('admin-login');

        // Settings
        const classSelect = document.getElementById('userClassSelect');
        CONFIG.classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            classSelect.appendChild(opt);
        });
        classSelect.value = dataManager.userData.classId;

        document.getElementById('saveUserSettingsBtn').onclick = () => {
            dataManager.userData.classId = document.getElementById('userClassSelect').value;
            dataManager.saveUserData();
            alert('設定を保存しました');
            app.navigate('dashboard');
        };

        // Google Auth Buttons
        document.getElementById('gcalLoginBtn').onclick = () => gcalManager.handleAuthClick();
        document.getElementById('gcalAuthBtnSmall').onclick = () => gcalManager.handleAuthClick();
        document.getElementById('gcalLogoutBtn').onclick = () => gcalManager.handleSignoutClick();

        // ToDo
        document.getElementById('addTodoBtn').onclick = app.addTodo;
        document.getElementById('newTodoInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') app.addTodo();
        });

        // Admin
        document.getElementById('adminLoginSubmit').onclick = () => {
            if (document.getElementById('adminPinInput').value === CONFIG.adminPin) {
                app.renderAdminPanel();
                app.navigate('admin');
            } else alert('PINエラー');
        };

        // Admin Tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
            };
        });

        // Admin Save
        document.getElementById('saveAdminDataBtn').onclick = async () => {
            app.saveAdminInputsToMemory();
            dataManager.saveGitHubConfig({
                owner: document.getElementById('ghOwner').value,
                repo: document.getElementById('ghRepo').value,
                path: document.getElementById('ghPath').value,
                token: document.getElementById('ghToken').value
            });
            await dataManager.saveAdminDataToGitHub();
        };
        
        document.getElementById('adminScheduleClassSelect').onchange = app.renderAdminScheduleEditor;
    },

    updateClock: () => {
        const now = new Date();
        document.getElementById('clockTime').textContent = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        document.getElementById('clockDate').textContent = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
        app.updateNextClass(now);
    },

    updateNextClass: (now) => {
        const currentTimeInt = now.getHours() * 60 + now.getMinutes();
        const settings = dataManager.adminData.timeSettings;
        let nextPeriod = null;

        for (let s of settings) {
            const [sh, sm] = s.start.split(':').map(Number);
            const [eh, em] = s.end.split(':').map(Number);
            const startInt = sh * 60 + sm;
            const endInt = eh * 60 + em;

            if (currentTimeInt < startInt) {
                nextPeriod = { p: s.period, status: 'before', diff: startInt - currentTimeInt };
                break;
            }
            if (currentTimeInt >= startInt && currentTimeInt <= endInt) {
                nextPeriod = { p: s.period, status: 'during', diff: endInt - currentTimeInt };
                break;
            }
        }

        const el = document.getElementById('nextClassDisplay');
        if (!nextPeriod) {
            el.textContent = "本日の授業は終了";
            return;
        }

        const userClass = dataManager.userData.classId;
        const dayMap = [null, "Mon", "Tue", "Wed", "Thu", "Fri", null];
        const dayStr = dayMap[now.getDay()];
        let subject = "---";
        if (userClass && dayStr && dataManager.adminData.schedule[userClass] && dataManager.adminData.schedule[userClass][dayStr]) {
            subject = dataManager.adminData.schedule[userClass][dayStr][nextPeriod.p - 1] || "---";
        }

        if (nextPeriod.status === 'before') {
            el.innerHTML = `<span style="font-size:0.8em">次は ${nextPeriod.p}限 (${subject})</span><br>開始まで ${nextPeriod.diff}分`;
        } else {
            el.innerHTML = `<span style="color:var(--primary-color)">${nextPeriod.p}限 授業中 (${subject})</span><br>残り ${nextPeriod.diff}分`;
        }
    },

    renderDashboard: () => {
        const classId = dataManager.userData.classId || '未設定';
        document.getElementById('headerClassName').textContent = classId;
        
        // Schedule List
        const dayIdx = new Date().getDay();
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayKey = days[dayIdx];
        const jpDays = ['日', '月', '火', '水', '木', '金', '土'];
        document.getElementById('scheduleDayBadge').textContent = jpDays[dayIdx];

        const schedList = document.getElementById('scheduleList');
        schedList.innerHTML = '';
        const classSched = dataManager.adminData.schedule[classId];

        if (!classSched || !classSched[dayKey] || dayIdx === 0 || dayIdx === 6) {
            schedList.innerHTML = '<p class="empty-state" style="text-align:center; color:#aaa;">授業なし</p>';
        } else {
            classSched[dayKey].forEach((sub, idx) => {
                if(!sub) return;
                const div = document.createElement('div');
                div.className = 'schedule-item';
                div.innerHTML = `<span class="period-num">${idx + 1}</span><span>${sub}</span>`;
                schedList.appendChild(div);
            });
        }

        // Test Countdown
        const tests = dataManager.adminData.tests;
        const testEl = document.getElementById('testCountdownDisplay');
        if (tests.length === 0) {
            testEl.textContent = "テスト予定なし";
        } else {
            const now = new Date();
            const futureTests = tests
                .map(t => ({...t, dateObj: new Date(t.date)}))
                .filter(t => t.dateObj >= now)
                .sort((a,b) => a.dateObj - b.dateObj);
            
            if(futureTests.length > 0) {
                const t = futureTests[0];
                const diff = Math.ceil((t.dateObj - now) / (86400000));
                testEl.innerHTML = `${t.name}まで<br><span style="font-size:1.5em; color: yellow;">あと ${diff} 日</span>`;
            } else {
                testEl.textContent = "全テスト終了";
            }
        }
        app.renderTodos();
    },

    addTodo: () => {
        const input = document.getElementById('newTodoInput');
        if (!input.value.trim()) return;
        dataManager.userData.todos.push({ text: input.value, done: false });
        dataManager.saveUserData();
        input.value = '';
        app.renderTodos();
    },
    
    toggleTodo: (idx) => {
        dataManager.userData.todos[idx].done = !dataManager.userData.todos[idx].done;
        dataManager.saveUserData();
        app.renderTodos();
    },
    
    deleteTodo: (idx) => {
        dataManager.userData.todos.splice(idx, 1);
        dataManager.saveUserData();
        app.renderTodos();
    },

    renderTodos: () => {
        const list = document.getElementById('todoList');
        list.innerHTML = '';
        const todos = dataManager.userData.todos;
        let doneCount = 0;
        todos.forEach((todo, idx) => {
            if(todo.done) doneCount++;
            const li = document.createElement('li');
            li.className = `todo-item ${todo.done ? 'completed' : ''}`;
            li.innerHTML = `
                <input type="checkbox" ${todo.done ? 'checked' : ''} onchange="app.toggleTodo(${idx})">
                <span style="flex:1">${todo.text}</span>
                <button onclick="app.deleteTodo(${idx})" style="background:none; border:none; color:#aaa; cursor:pointer;">&times;</button>
            `;
            list.appendChild(li);
        });
        const pct = todos.length ? (doneCount/todos.length)*100 : 0;
        document.getElementById('todoProgress').textContent = `${doneCount}/${todos.length}`;
        document.getElementById('todoProgressBar').style.width = `${pct}%`;
    },

    renderAdminPanel: () => {
        // Time Settings
        const timeList = document.getElementById('adminTimeSettingsList');
        timeList.innerHTML = '';
        dataManager.adminData.timeSettings.forEach((ts, idx) => {
            const div = document.createElement('div');
            div.style.marginBottom = "0.5rem";
            div.innerHTML = `<b>${ts.period}</b> <input type="time" value="${ts.start}" data-idx="${idx}" data-key="start"> - <input type="time" value="${ts.end}" data-idx="${idx}" data-key="end">`;
            timeList.appendChild(div);
        });

        // Schedule Editor
        const schedSel = document.getElementById('adminScheduleClassSelect');
        schedSel.innerHTML = '';
        CONFIG.classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            schedSel.appendChild(opt);
        });
        schedSel.value = CONFIG.classes[0];
        app.renderAdminScheduleEditor();

        // GitHub Config
        const gh = dataManager.githubConfig;
        document.getElementById('ghOwner').value = gh.owner;
        document.getElementById('ghRepo').value = gh.repo;
        document.getElementById('ghPath').value = gh.path;
        document.getElementById('ghToken').value = gh.token;
    },

    renderAdminScheduleEditor: () => {
        const classId = document.getElementById('adminScheduleClassSelect').value;
        const container = document.getElementById('adminScheduleEditor');
        container.innerHTML = '';
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        
        // Header
        container.appendChild(document.createElement('div')).textContent = "限";
        days.forEach(d => {
            const h = document.createElement('div'); h.textContent = d; h.style.fontWeight="bold"; h.style.textAlign="center";
            container.appendChild(h);
        });

        for (let p = 1; p <= 7; p++) {
            container.appendChild(document.createElement('div')).textContent = p;
            days.forEach(day => {
                const val = (dataManager.adminData.schedule[classId]?.[day]?.[p-1]) || '';
                const cell = document.createElement('div');
                cell.className = 'sched-edit-cell';
                const input = document.createElement('input');
                input.value = val;
                input.dataset.class = classId; input.dataset.day = day; input.dataset.pidx = p-1;
                cell.appendChild(input);
                container.appendChild(cell);
            });
        }
    },

    saveAdminInputsToMemory: () => {
        // Time
        document.querySelectorAll('#adminTimeSettingsList input').forEach(inp => {
            if(inp.dataset.key) dataManager.adminData.timeSettings[inp.dataset.idx][inp.dataset.key] = inp.value;
        });
        // Schedule
        const classId = document.getElementById('adminScheduleClassSelect').value;
        if (!dataManager.adminData.schedule[classId]) dataManager.adminData.schedule[classId] = {};
        document.querySelectorAll('.sched-edit-cell input').forEach(inp => {
            if (inp.dataset.class === classId) {
                if (!dataManager.adminData.schedule[classId][inp.dataset.day]) dataManager.adminData.schedule[classId][inp.dataset.day] = [];
                dataManager.adminData.schedule[classId][inp.dataset.day][inp.dataset.pidx] = inp.value;
            }
        });
    }
};

window.onload = () => {
    app.init();
    // Google API Libraryのロード待機
    setTimeout(() => gcalManager.init(), 1000); 
};