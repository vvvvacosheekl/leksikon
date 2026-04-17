let socket, token, currentUser;
let currentChatUser = null;
let allUsers = [];
let unreadCounts = {};

const authScreen = document.getElementById('authScreen');
const messengerScreen = document.getElementById('messengerScreen');
const usersListDiv = document.getElementById('usersList');
const messagesListDiv = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatUsernameSpan = document.getElementById('chatUsername');
const chatStatusSpan = document.getElementById('chatStatus');
const chatAvatar = document.getElementById('chatAvatar');
const currentUsernameSpan = document.getElementById('currentUsername');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const currentUserStars = document.getElementById('currentUserStars');
const settingsPanel = document.getElementById('settingsPanel');
const searchInput = document.getElementById('searchUsers');
const sidebar = document.getElementById('sidebar');
const menuBtn = document.getElementById('menuBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');

if (menuBtn) menuBtn.onclick = () => sidebar.classList.add('open');
if (closeSidebarBtn) closeSidebarBtn.onclick = () => sidebar.classList.remove('open');

function updateAvatarElement(element, avatarUrl, username) {
    if (!element) return;
    if (avatarUrl) {
        element.style.backgroundImage = `url(${avatarUrl})`;
        element.style.backgroundSize = 'cover';
        element.style.textContent = '';
    } else {
        element.style.background = `linear-gradient(135deg, #8b5cf6, #a78bfa)`;
        element.textContent = username ? username[0].toUpperCase() : '?';
    }
}

function updateChatStatus(online, last_seen) {
    if (online) {
        chatStatusSpan.innerHTML = '🟢 Онлайн';
    } else if (last_seen) {
        const date = new Date(last_seen);
        const diff = Math.floor((Date.now() - date) / 60000);
        if (diff < 1) chatStatusSpan.innerHTML = 'был(а) только что';
        else if (diff < 60) chatStatusSpan.innerHTML = `был(а) ${diff} мин назад`;
        else chatStatusSpan.innerHTML = `был(а) в ${date.toLocaleTimeString()}`;
    } else {
        chatStatusSpan.innerHTML = 'Не в сети';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function appendMessage(msg, isMy) {
    const div = document.createElement('div');
    div.className = 'message ' + (isMy ? 'my' : '');
    div.setAttribute('data-msg-id', msg.id);
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let content = '';
    if (msg.fileUrl && msg.fileType?.startsWith('image/')) {
        content += `<img src="${msg.fileUrl}" style="max-width: 200px; max-height: 200px; border-radius: 12px;">`;
    }
    if (msg.text) content += `<div>${escapeHtml(msg.text)}</div>`;
    if (msg.edited) content += `<small style="opacity:0.5;">(ред.)</small>`;
    content += `<div class="message-time">${time}</div>`;
    div.innerHTML = content;
    
    if (isMy) {
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.style.marginLeft = '8px';
        editBtn.style.background = 'none';
        editBtn.style.border = 'none';
        editBtn.style.cursor = 'pointer';
        editBtn.onclick = () => {
            const newText = prompt('Редактировать:', msg.text);
            if (newText && newText !== msg.text) {
                fetch(`/api/messages/${msg.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ text: newText })
                });
                socket.emit('edit_message', { messageId: msg.id, text: newText });
            }
        };
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.style.marginLeft = '8px';
        delBtn.style.background = 'none';
        delBtn.style.border = 'none';
        delBtn.style.cursor = 'pointer';
        delBtn.onclick = () => {
            if (confirm('Удалить сообщение?')) {
                fetch(`/api/messages/${msg.id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
                socket.emit('delete_message', msg.id);
            }
        };
        div.appendChild(editBtn);
        div.appendChild(delBtn);
    }
    messagesListDiv.appendChild(div);
    messagesListDiv.parentElement.scrollTop = messagesListDiv.parentElement.scrollHeight;
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}Form`).classList.add('active');
    });
});

document.getElementById('sendCodeBtn').onclick = async () => {
    const email = document.getElementById('regEmail').value;
    if (!email) { alert('Введите email'); return; }
    const res = await fetch('/api/send-email-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (res.ok) {
        alert('Код отправлен на почту!');
        document.getElementById('regCode').style.display = 'block';
    } else alert('Ошибка');
};

document.getElementById('regCode').oninput = async () => {
    const code = document.getElementById('regCode').value;
    const email = document.getElementById('regEmail').value;
    if (code.length === 6) {
        const res = await fetch('/api/verify-email-code', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (data.success) {
            const regRes = await fetch('/api/register', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const regData = await regRes.json();
            if (regRes.ok) {
                token = regData.token;
                currentUser = regData.user;
                localStorage.setItem('token', token);
                initMessenger();
            }
        } else alert('Неверный код');
    }
};

let loginMethod = 'code';
document.getElementById('sendLoginCodeBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value;
    if (!email) { alert('Введите email'); return; }
    await fetch('/api/send-email-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    alert('Код отправлен на почту');
};
document.getElementById('loginWithCodeBtn').onclick = () => {
    loginMethod = 'code';
    document.getElementById('loginWithCodeBtn').classList.add('active');
    document.getElementById('loginWithPasswordBtn').classList.remove('active');
    document.getElementById('loginCodeDiv').style.display = 'block';
    document.getElementById('loginPasswordDiv').style.display = 'none';
};
document.getElementById('loginWithPasswordBtn').onclick = () => {
    loginMethod = 'password';
    document.getElementById('loginWithPasswordBtn').classList.add('active');
    document.getElementById('loginWithCodeBtn').classList.remove('active');
    document.getElementById('loginCodeDiv').style.display = 'none';
    document.getElementById('loginPasswordDiv').style.display = 'block';
};
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    if (loginMethod === 'code') {
        const code = document.getElementById('loginCode').value;
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (res.ok) {
            token = data.token;
            currentUser = data.user;
            localStorage.setItem('token', token);
            initMessenger();
        } else alert('Ошибка: ' + data.error);
    } else {
        const password = document.getElementById('loginPassword').value;
        const res = await fetch('/api/login-password', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            token = data.token;
            currentUser = data.user;
            localStorage.setItem('token', token);
            initMessenger();
        } else alert('Ошибка: ' + data.error);
    }
});

function logout() {
    localStorage.removeItem('token');
    if (socket) socket.disconnect();
    window.location.reload();
}
document.getElementById('addAccountBtn').onclick = () => {
    if (confirm('Выйти и войти в другой аккаунт?')) logout();
};

async function initMessenger() {
    authScreen.style.display = 'none';
    messengerScreen.style.display = 'block';
    currentUsernameSpan.textContent = currentUser.username || currentUser.email?.split('@')[0] || 'User';
    if (currentUserStars) currentUserStars.textContent = `⭐ ${currentUser.stars || 0}`;
    updateAvatarElement(currentUserAvatar, currentUser.avatar, currentUser.username);
    
    const savedTheme = localStorage.getItem('theme');
    const savedFontSize = localStorage.getItem('fontSize');
    const savedBorderRadius = localStorage.getItem('borderRadius');
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
        document.getElementById('themeSelect').value = savedTheme;
    } else document.body.setAttribute('data-theme', 'purple');
    if (savedFontSize) {
        document.body.style.setProperty('--font-size', savedFontSize + 'px');
        document.getElementById('fontSizeSlider').value = savedFontSize;
        document.getElementById('fontSizeValue').textContent = savedFontSize;
    }
    if (savedBorderRadius) {
        document.body.style.setProperty('--border-radius', savedBorderRadius + 'px');
        document.getElementById('borderRadiusSlider').value = savedBorderRadius;
        document.getElementById('borderRadiusValue').textContent = savedBorderRadius;
    }
    
    await loadUsers();
    
    if (socket) socket.disconnect();
    
    socket = io({
        auth: { token },
        transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
        console.log('✅ Socket.IO connected!');
    });
    
    socket.on('connect_error', (err) => {
        console.error('❌ Socket.IO error:', err.message);
    });
    
    socket.on('new_message', (msg) => {
        console.log('📨 Получено сообщение:', msg);
        
        // Показываем сообщение если оно от текущего собеседника ИЛИ от меня самого (для отправителя)
        if (currentChatUser && (msg.from_user_id === currentChatUser.id || msg.from_user_id === currentUser.id)) {
            const isMy = (msg.from_user_id === currentUser.id);
            appendMessage(msg, isMy);
        } else {
            // Если сообщение от кого-то другого - увеличиваем счетчик непрочитанных
            if (msg.from_user_id !== currentUser.id) {
                unreadCounts[msg.from_user_id] = (unreadCounts[msg.from_user_id] || 0) + 1;
            }
            loadUsers();
        }
    });
    
    socket.on('message_edited', ({ messageId, text }) => {
        const msgDiv = document.querySelector(`.message[data-msg-id="${messageId}"]`);
        if (msgDiv) {
            const textDiv = msgDiv.querySelector('div');
            if (textDiv) textDiv.innerHTML = escapeHtml(text);
        }
    });
    
    socket.on('message_deleted', (messageId) => {
        const msgDiv = document.querySelector(`.message[data-msg-id="${messageId}"]`);
        if (msgDiv) msgDiv.remove();
    });
    
    socket.on('user_status', ({ userId, online }) => {
        const u = allUsers.find(u => u.id === userId);
        if (u) { u.online = online; renderUsersList(); }
        if (currentChatUser?.id === userId) updateChatStatus(online, null);
    });
    
    socket.on('user_typing', ({ from_user_id }) => {
        if (currentChatUser?.id === from_user_id) showTyping();
    });
    
    sendBtn.onclick = sendMessage;
    messageInput.onkeypress = (e) => { 
        if (e.key === 'Enter') sendMessage(); 
        else if (currentChatUser) socket.emit('typing', currentChatUser.id); 
    };
    if (document.getElementById('photoBtn')) document.getElementById('photoBtn').onclick = sendPhoto;
    if (document.getElementById('stickerBtn')) document.getElementById('stickerBtn').onclick = showStickers;
    if (searchInput) searchInput.oninput = () => renderUsersList();
}

async function loadUsers() {
    const res = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 401) { logout(); return; }
    allUsers = await res.json();
    renderUsersList();
}

function renderUsersList() {
    const term = searchInput?.value.toLowerCase() || '';
    const filtered = allUsers.filter(u => (u.username || u.email).toLowerCase().includes(term));
    usersListDiv.innerHTML = filtered.map(u => `
        <div class="user-item ${currentChatUser?.id === u.id ? 'active' : ''}" onclick="openChatUser(${u.id})">
            <div class="user-avatar" style="${u.avatar ? `background-image:url(${u.avatar});background-size:cover` : `background:linear-gradient(135deg,#8b5cf6,#a78bfa)`}">${!u.avatar && (u.username?.[0]?.toUpperCase() || '?')}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(u.username || u.email.split('@')[0])}</div>
                <div class="user-status">${u.online ? '🟢 Онлайн' : '⚫ Не в сети'}</div>
            </div>
            ${unreadCounts[u.id] ? `<span class="unread">${unreadCounts[u.id]}</span>` : ''}
        </div>
    `).join('');
}

async function openChatUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    currentChatUser = user;
    chatUsernameSpan.textContent = user.username || user.email?.split('@')[0];
    updateAvatarElement(chatAvatar, user.avatar, user.username);
    updateChatStatus(user.online, user.last_seen);
    delete unreadCounts[user.id];
    const res = await fetch(`/api/messages/${user.id}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const msgs = await res.json();
    messagesListDiv.innerHTML = '';
    msgs.forEach(m => appendMessage(m, m.from_user_id === currentUser.id));
    renderUsersList();
    if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
}

async function sendMessage() {
    if (!currentChatUser) { alert('Выберите собеседника'); return; }
    const text = messageInput.value.trim();
    if (!text) return;
    socket.emit('private_message', { to_user_id: currentChatUser.id, text });
    messageInput.value = '';
}

async function sendPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const fd = new FormData();
        fd.append('file', input.files[0]);
        const res = await fetch('/api/upload-file', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
        const { fileUrl } = await res.json();
        socket.emit('private_message', { to_user_id: currentChatUser.id, text: '', fileUrl, fileType: 'image' });
    };
    input.click();
}

function showStickers() {
    const picker = document.createElement('div');
    picker.style.position = 'fixed';
    picker.style.bottom = '80px';
    picker.style.left = '20px';
    picker.style.background = 'var(--bg-card)';
    picker.style.borderRadius = '16px';
    picker.style.padding = '10px';
    picker.style.display = 'grid';
    picker.style.gridTemplateColumns = 'repeat(4, 1fr)';
    picker.style.gap = '8px';
    picker.style.zIndex = '1000';
    ['😀', '😂', '🥰', '🔥', '🎉', '💀', '🤡', '👑'].forEach(s => {
        const btn = document.createElement('button');
        btn.textContent = s;
        btn.style.fontSize = '24px';
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.cursor = 'pointer';
        btn.onclick = () => {
            socket.emit('private_message', { to_user_id: currentChatUser.id, text: s });
            picker.remove();
        };
        picker.appendChild(btn);
    });
    document.body.appendChild(picker);
    setTimeout(() => picker.remove(), 5000);
}

let typingTimeout;
function showTyping() {
    let ind = document.querySelector('.typing-indicator');
    if (!ind) {
        ind = document.createElement('div');
        ind.className = 'typing-indicator';
        messagesListDiv.parentElement.insertBefore(ind, messagesListDiv.parentElement.firstChild);
    }
    ind.textContent = `${currentChatUser?.username || 'Собеседник'} печатает...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => ind?.remove(), 1500);
}

document.getElementById('settingsBtn').onclick = () => {
    loadProfile();
    settingsPanel.style.display = 'block';
    setTimeout(() => settingsPanel.classList.add('open'), 10);
    if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
};
document.getElementById('closeSettingsBtn').onclick = () => {
    settingsPanel.classList.remove('open');
    setTimeout(() => settingsPanel.style.display = 'none', 300);
};
document.getElementById('themeSelect').onchange = async (e) => {
    const theme = e.target.value;
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ theme }) });
};
document.getElementById('fontSizeSlider').oninput = (e) => {
    const val = e.target.value;
    document.getElementById('fontSizeValue').textContent = val;
    document.body.style.setProperty('--font-size', val + 'px');
    localStorage.setItem('fontSize', val);
};
document.getElementById('borderRadiusSlider').oninput = (e) => {
    const val = e.target.value;
    document.getElementById('borderRadiusValue').textContent = val;
    document.body.style.setProperty('--border-radius', val + 'px');
    localStorage.setItem('borderRadius', val);
};
document.getElementById('uploadAvatarBtn').onclick = async () => {
    const file = document.getElementById('avatarInput').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    const res = await fetch('/api/upload-avatar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
    if (res.ok) { alert('Аватарка обновлена'); loadProfile(); loadUsers(); }
};
document.getElementById('updateProfileBtn').onclick = async () => {
    const username = document.getElementById('profileUsername').value || null;
    const bio = document.getElementById('profileBio').value;
    const birthDate = document.getElementById('profileBirthDate').value;
    await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ username, bio, birthDate }) });
    alert('Профиль сохранен');
    if (username) currentUsernameSpan.textContent = username;
    loadUsers();
};
document.getElementById('showSetPasswordBtn').onclick = () => document.getElementById('setPasswordDiv').style.display = 'block';
document.getElementById('confirmPasswordBtn').onclick = async () => {
    const password = document.getElementById('newPassword').value;
    await fetch('/api/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ password }) });
    alert('Пароль установлен');
    document.getElementById('setPasswordDiv').style.display = 'none';
};
document.getElementById('privacyEmailVisible').onchange = async (e) => {
    await fetch('/api/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ emailVisible: e.target.value }) });
};
async function loadProfile() {
    const res = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
    const u = await res.json();
    document.getElementById('profileUsername').value = u.username || '';
    document.getElementById('profileBio').value = u.bio || '';
    document.getElementById('profileBirthDate').value = u.birthDate || '';
    const av = document.getElementById('profileAvatar');
    if (u.avatar) { av.src = u.avatar; av.style.background = 'none'; av.textContent = ''; }
    else { av.src = ''; av.style.background = 'linear-gradient(135deg,#8b5cf6,#a78bfa)'; av.textContent = u.username?.[0]?.toUpperCase() || '?'; }
    updateAvatarElement(currentUserAvatar, u.avatar, u.username);
}
function detectDevice() {
    const width = window.innerWidth;
    const isMobile = width < 768;
    const deviceInfo = document.getElementById('deviceInfo');
    if (deviceInfo) deviceInfo.innerHTML = `${isMobile ? '📱 Телефон' : '💻 Компьютер'}<br>${width} × ${window.innerHeight}`;
}
detectDevice();
window.addEventListener('resize', detectDevice);

const savedToken = localStorage.getItem('token');
if (savedToken) {
    token = savedToken;
    fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(res => { if (res.ok) return res.json().then(u => { currentUser = u; initMessenger(); }); else localStorage.removeItem('token'); });
}

window.openChatUser = openChatUser;