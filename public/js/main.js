let socket, token, currentUser;
let currentChatUser = null;
let currentGroup = null;
let allUsers = [];
let groups = [];
let unreadCounts = {};
let mediaRecorder;
let audioChunks = [];
let peerConnection;
let localStream;
let currentCallId = null;

// ============ PWA УСТАНОВКА НА ТЕЛЕФОН ============
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('✅ PWA: приложение можно установить на телефон');
        }).catch(err => {
            console.log('❌ PWA ошибка:', err);
        });
    });
}

const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const authScreen = document.getElementById('authScreen');
const messengerScreen = document.getElementById('messengerScreen');
const usersListDiv = document.getElementById('usersList');
const groupsListDiv = document.getElementById('groupsList');
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
const callModal = document.getElementById('callModal');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const searchResultsDiv = document.getElementById('searchResults');

// ============ ЗВУК УВЕДОМЛЕНИЯ ============
function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,U3RlYWx0aCB3YXZlIGZpbGUgaGVyZQ==');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Звук не воспроизвелся:', e));
    } catch(e) { console.log('Ошибка звука'); }
}

// ============ ВСПЛЫВАЮЩЕЕ УВЕДОМЛЕНИЕ ============
function showNotification(title, body, avatar) {
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, { body, icon: avatar || '/favicon.ico' });
        setTimeout(() => notification.close(), 5000);
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
                const notification = new Notification(title, { body, icon: avatar || '/favicon.ico' });
                setTimeout(() => notification.close(), 5000);
            }
        });
    }
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div class="notification-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #a78bfa); display: flex; align-items: center; justify-content: center; font-weight: bold; color: white;">${avatar ? '' : title[0]?.toUpperCase() || '?'}</div>
            <div>
                <div style="font-weight: bold; font-size: 14px;">${escapeHtml(title)}</div>
                <div style="font-size: 12px; color: #888;">${escapeHtml(body)}</div>
            </div>
        </div>
    `;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = 'var(--bg-card)';
    toast.style.color = 'var(--text-primary)';
    toast.style.padding = '12px 16px';
    toast.style.borderRadius = '12px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    toast.style.zIndex = '10000';
    toast.style.cursor = 'pointer';
    toast.style.maxWidth = '300px';
    toast.style.border = '1px solid var(--border)';
    toast.onclick = () => {
        toast.remove();
        if (window.lastNotifiedUserId) {
            openChatUser(window.lastNotifiedUserId);
        }
    };
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

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
    if (online) chatStatusSpan.innerHTML = '🟢 Онлайн';
    else if (last_seen) {
        const date = new Date(last_seen);
        const diff = Math.floor((Date.now() - date) / 60000);
        if (diff < 1) chatStatusSpan.innerHTML = 'был(а) только что';
        else if (diff < 60) chatStatusSpan.innerHTML = `был(а) ${diff} мин назад`;
        else chatStatusSpan.innerHTML = `был(а) в ${date.toLocaleTimeString()}`;
    } else chatStatusSpan.innerHTML = 'Не в сети';
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
    if (msg.fileUrl && msg.fileType?.startsWith('image/')) content += `<img src="${msg.fileUrl}" style="max-width: 200px; max-height: 200px; border-radius: 12px;">`;
    if (msg.voiceUrl) content += `<audio controls src="${msg.voiceUrl}" style="width: 200px;"></audio>`;
    if (msg.text) content += `<div>${escapeHtml(msg.text)}</div>`;
    if (msg.edited) content += `<small style="opacity:0.5;">(ред.)</small>`;
    content += `<div class="message-time">${time}</div>`;
    div.innerHTML = content;
    if (isMy) {
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.style.marginLeft = '8px';
        editBtn.onclick = () => {
            const newText = prompt('Редактировать:', msg.text);
            if (newText && newText !== msg.text) {
                fetch(`/api/messages/${msg.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ text: newText }) });
                socket.emit('edit_message', { messageId: msg.id, text: newText });
            }
        };
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
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

// ============ АВТОРИЗАЦИЯ ============
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
    const res = await fetch('/api/send-email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (res.ok) { alert('Код отправлен на почту!'); document.getElementById('regCode').style.display = 'block'; } else alert('Ошибка');
};

document.getElementById('regCode').oninput = async () => {
    const code = document.getElementById('regCode').value;
    const email = document.getElementById('regEmail').value;
    if (code.length === 6) {
        const res = await fetch('/api/verify-email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
        const data = await res.json();
        if (data.success) {
            const regRes = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
            const regData = await regRes.json();
            if (regRes.ok) { token = regData.token; currentUser = regData.user; localStorage.setItem('token', token); initMessenger(); }
        } else alert('Неверный код');
    }
};

let loginMethod = 'code';
document.getElementById('sendLoginCodeBtn').onclick = async () => {
    const email = document.getElementById('loginEmail').value;
    if (!email) { alert('Введите email'); return; }
    await fetch('/api/send-email-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
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
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
        const data = await res.json();
        if (res.ok) { token = data.token; currentUser = data.user; localStorage.setItem('token', token); initMessenger(); } else alert('Ошибка: ' + data.error);
    } else {
        const password = document.getElementById('loginPassword').value;
        const res = await fetch('/api/login-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data = await res.json();
        if (res.ok) { token = data.token; currentUser = data.user; localStorage.setItem('token', token); initMessenger(); } else alert('Ошибка: ' + data.error);
    }
});

document.getElementById('appleLoginBtn').onclick = async () => {
    const email = prompt('Введите ваш Apple ID (email @icloud.com):');
    if (!email) return;
    if (!email.endsWith('@icloud.com')) { alert('Введите корректный Apple ID (@icloud.com)'); return; }
    const name = prompt('Ваше имя (опционально):');
    const res = await fetch('/api/login-apple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name: name || null }) });
    const data = await res.json();
    if (res.ok) { token = data.token; currentUser = data.user; localStorage.setItem('token', token); initMessenger(); } else alert('Ошибка: ' + data.error);
};

function logout() { localStorage.removeItem('token'); if (socket) socket.disconnect(); window.location.reload(); }
document.getElementById('addAccountBtn').onclick = () => { if (confirm('Выйти и войти в другой аккаунт?')) logout(); };

// ============ ПОИСК ============
if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', async () => {
        clearTimeout(searchTimeout);
        let q = searchInput.value.trim();
        if (q.startsWith('@')) q = q.substring(1);
        if (q.length < 2) { if (searchResultsDiv) searchResultsDiv.innerHTML = ''; renderUsersList(); return; }
        searchTimeout = setTimeout(async () => {
            const res = await fetch(`/api/search-user?q=${encodeURIComponent(q)}`, { headers: { 'Authorization': 'Bearer ' + token } });
            const results = await res.json();
            if (!searchResultsDiv) return;
            if (results.length === 0) { searchResultsDiv.innerHTML = '<div style="padding: 8px; color: gray; text-align: center;">😕 Пользователь не найден</div>'; return; }
            searchResultsDiv.innerHTML = results.map(u => `<div class="search-result-item" onclick="openChatUser(${u.id})" style="padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 12px;"><div class="user-avatar" style="width: 40px; height: 40px; ${u.avatar ? `background-image:url(${u.avatar});background-size:cover` : `background:linear-gradient(135deg,#8b5cf6,#a78bfa)`}">${!u.avatar && (u.username?.[0]?.toUpperCase() || '?')}</div><div><div><strong>${escapeHtml(u.username)}</strong></div><div style="font-size: 12px; color: gray;">${escapeHtml(u.email)}</div></div></div>`).join('');
        }, 300);
    });
}

// ============ ГОЛОСОВЫЕ ============
const voiceBtn = document.getElementById('voiceBtn');
if (voiceBtn) {
    voiceBtn.onmousedown = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('file', blob, 'voice.webm');
                const res = await fetch('/api/upload-file', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData });
                const { fileUrl } = await res.json();
                if (currentChatUser) socket.emit('voice_message', { to_user_id: currentChatUser.id, voiceUrl: fileUrl, duration: 0 });
            };
            mediaRecorder.start();
        } catch(e) { alert('Нет доступа к микрофону'); }
    };
    voiceBtn.onmouseup = () => { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); };
}

// ============ ЗВОНКИ ============
async function startCall(isVideo) {
    if (!currentChatUser) { alert('Выберите собеседника'); return; }
    callModal.style.display = 'flex';
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
        if (isVideo && localVideo) localVideo.srcObject = localStream;
        peerConnection = new RTCPeerConnection(configuration);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        if (remoteVideo) peerConnection.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
        peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('webrtc_ice', { to: currentChatUser.id, candidate: e.candidate }); };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc_offer', { to: currentChatUser.id, offer });
    } catch(e) { alert('Ошибка доступа к камере/микрофону'); }
}
const callBtn = document.getElementById('callBtn');
const videoCallBtn = document.getElementById('videoCallBtn');
const hangupBtn = document.getElementById('hangupBtn');
if (callBtn) callBtn.onclick = () => startCall(false);
if (videoCallBtn) videoCallBtn.onclick = () => startCall(true);
if (hangupBtn) hangupBtn.onclick = async () => {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    callModal.style.display = 'none';
};

socket?.on('webrtc_offer', async (data) => {
    callModal.style.display = 'flex';
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    if (localVideo) localVideo.srcObject = localStream;
    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    if (remoteVideo) peerConnection.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };
    peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('webrtc_ice', { to: data.from, candidate: e.candidate }); };
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc_answer', { to: data.from, answer });
});
socket?.on('webrtc_answer', async (data) => { await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer)); });
socket?.on('webrtc_ice', async (data) => { if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); });

// ============ ГРУППЫ ============
const createGroupBtn = document.getElementById('createGroupBtn');
if (createGroupBtn) {
    createGroupBtn.onclick = async () => {
        const name = prompt('Название группы:');
        if (!name) return;
        const res = await fetch('/api/create-group', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ name, members: [] }) });
        if (res.ok) { alert('Группа создана!'); loadGroups(); }
    };
}
async function loadGroups() {
    const res = await fetch('/api/groups', { headers: { 'Authorization': 'Bearer ' + token } });
    groups = await res.json();
    renderGroupsList();
}
function renderGroupsList() {
    if (!groupsListDiv) return;
    groupsListDiv.innerHTML = '<div style="padding: 10px; font-weight: bold;">📁 Группы</div>';
    groups.forEach(g => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `<div class="user-avatar">👥</div><div class="user-info"><div class="user-name">${escapeHtml(g.name)}</div></div>`;
        div.onclick = () => openGroupChat(g);
        groupsListDiv.appendChild(div);
    });
}
async function openGroupChat(group) {
    currentGroup = group;
    currentChatUser = null;
    chatUsernameSpan.textContent = group.name;
    updateAvatarElement(chatAvatar, null, '👥');
    chatStatusSpan.innerHTML = `${group.members.length} участников`;
    const res = await fetch(`/api/group-messages/${group.id}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const msgs = await res.json();
    messagesListDiv.innerHTML = '';
    msgs.forEach(m => appendMessage(m, m.from_user_id === currentUser.id));
    sidebar.classList.remove('open');
}

// ============ ЗВЕЗДЫ ============
const shopBtn = document.getElementById('shopBtn');
if (shopBtn) {
    shopBtn.onclick = () => {
        const amount = prompt('Сколько звезд купить? (100 звезд = 1 рубль)', '100');
        if (amount) { fetch('/api/buy-stars', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ amount: parseInt(amount) }) }); alert('Звезды добавлены!'); loadProfile(); }
    };
}

// ============ ОСНОВНОЙ МЕССЕНДЖЕР ============
async function initMessenger() {
    authScreen.style.display = 'none';
    messengerScreen.style.display = 'block';
    currentUsernameSpan.textContent = currentUser.username || currentUser.email?.split('@')[0] || 'User';
    if (currentUserStars) currentUserStars.textContent = `⭐ ${currentUser.stars || 0}`;
    updateAvatarElement(currentUserAvatar, currentUser.avatar, currentUser.username);
    
    const savedTheme = localStorage.getItem('theme');
    const savedFontSize = localStorage.getItem('fontSize');
    const savedBorderRadius = localStorage.getItem('borderRadius');
    if (savedTheme) { document.body.setAttribute('data-theme', savedTheme); document.getElementById('themeSelect').value = savedTheme; } else document.body.setAttribute('data-theme', 'purple');
    if (savedFontSize) { document.body.style.setProperty('--font-size', savedFontSize + 'px'); document.getElementById('fontSizeSlider').value = savedFontSize; document.getElementById('fontSizeValue').textContent = savedFontSize; }
    if (savedBorderRadius) { document.body.style.setProperty('--border-radius', savedBorderRadius + 'px'); document.getElementById('borderRadiusSlider').value = savedBorderRadius; document.getElementById('borderRadiusValue').textContent = savedBorderRadius; }
    
    await loadUsers();
    await loadGroups();
    await loadProfile();
    
    if (socket) socket.disconnect();
    socket = io({ auth: { token } });
    
    socket.on('connect', () => console.log('✅ Socket.IO connected!'));
    
    socket.on('new_message', (msg) => {
        if (msg.from_user_id !== currentUser.id) {
            playNotificationSound();
            const sender = allUsers.find(u => u.id === msg.from_user_id);
            const senderName = sender?.username || 'Пользователь';
            const messageText = msg.text ? (msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text) : (msg.fileUrl ? '📷 Фото' : (msg.voiceUrl ? '🎤 Голосовое' : 'Сообщение'));
            showNotification(`@${senderName}`, messageText, sender?.avatar);
            window.lastNotifiedUserId = msg.from_user_id;
        }
        if (currentChatUser && (msg.from_user_id === currentChatUser.id || msg.from_user_id === currentUser.id)) {
            appendMessage(msg, msg.from_user_id === currentUser.id);
        } else if (!currentChatUser && !currentGroup) {
            unreadCounts[msg.from_user_id] = (unreadCounts[msg.from_user_id] || 0) + 1;
            loadUsers();
        }
    });
    
    socket.on('group_message', (msg) => {
        if (msg.from_user_id !== currentUser.id) {
            playNotificationSound();
            const group = groups.find(g => g.id === msg.group_id);
            const senderName = msg.from_username || 'Участник';
            showNotification(`📁 ${group?.name || 'Группа'}`, `${senderName}: ${msg.text?.substring(0, 50) || 'Сообщение'}`);
        }
        if (currentGroup && msg.group_id === currentGroup.id) {
            appendMessage(msg, msg.from_user_id === currentUser.id);
        }
    });
    
    socket.on('message_edited', ({ messageId, text }) => { const msgDiv = document.querySelector(`.message[data-msg-id="${messageId}"]`); if (msgDiv && msgDiv.querySelector('div')) msgDiv.querySelector('div').innerHTML = escapeHtml(text); });
    socket.on('message_deleted', (messageId) => document.querySelector(`.message[data-msg-id="${messageId}"]`)?.remove());
    socket.on('user_status', ({ userId, online }) => { const u = allUsers.find(u => u.id === userId); if (u) { u.online = online; renderUsersList(); } if (currentChatUser?.id === userId) updateChatStatus(online, null); });
    socket.on('user_typing', ({ from_user_id }) => { if (currentChatUser?.id === from_user_id) showTyping(); });
    socket.on('gift_received', ({ from, gift_type }) => { playNotificationSound(); showNotification('🎁 Подарок!', `${from} подарил вам ${gift_type}`); });
    
    sendBtn.onclick = sendMessage;
    messageInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); else if (currentChatUser) socket.emit('typing'); };
    const photoBtn = document.getElementById('photoBtn');
    if (photoBtn) photoBtn.onclick = sendPhoto;
    const stickerBtn = document.getElementById('stickerBtn');
    if (stickerBtn) stickerBtn.onclick = showStickers;
}

async function loadUsers() {
    const res = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 401) { logout(); return; }
    allUsers = await res.json();
    renderUsersList();
}
function renderUsersList() {
    if (searchResultsDiv && searchResultsDiv.innerHTML !== '') return;
    usersListDiv.innerHTML = allUsers.map(u => `<div class="user-item ${currentChatUser?.id === u.id ? 'active' : ''}" onclick="openChatUser(${u.id})"><div class="user-avatar" style="${u.avatar ? `background-image:url(${u.avatar});background-size:cover` : `background:linear-gradient(135deg,#8b5cf6,#a78bfa)`}">${!u.avatar && (u.username?.[0]?.toUpperCase() || '?')}</div><div class="user-info"><div class="user-name">${escapeHtml(u.username)}</div><div class="user-status">${u.online ? '🟢 Онлайн' : '⚫ Не в сети'}</div></div>${unreadCounts[u.id] ? `<span class="unread">${unreadCounts[u.id]}</span>` : ''}</div>`).join('');
}
async function openChatUser(userId) {
    if (searchResultsDiv) searchResultsDiv.innerHTML = '';
    if (searchInput) searchInput.value = '';
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    currentChatUser = user;
    currentGroup = null;
    chatUsernameSpan.textContent = user.username;
    updateAvatarElement(chatAvatar, user.avatar, user.username);
    updateChatStatus(user.online, user.last_seen);
    delete unreadCounts[user.id];
    const res = await fetch(`/api/messages/${user.id}`, { headers: { 'Authorization': 'Bearer ' + token } });
    const msgs = await res.json();
    messagesListDiv.innerHTML = '';
    msgs.forEach(m => appendMessage(m, m.from_user_id === currentUser.id));
    renderUsersList();
    sidebar.classList.remove('open');
}
async function sendMessage() {
    if (!currentChatUser && !currentGroup) { alert('Выберите собеседника или группу'); return; }
    const text = messageInput.value.trim();
    if (!text) return;
    if (currentChatUser) socket.emit('private_message', { to_user_id: currentChatUser.id, text });
    else if (currentGroup) socket.emit('group_message', { group_id: currentGroup.id, text });
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
        if (currentChatUser) socket.emit('private_message', { to_user_id: currentChatUser.id, text: '', fileUrl, fileType: 'image' });
        else if (currentGroup) socket.emit('group_message', { group_id: currentGroup.id, text: '', fileUrl });
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
        btn.onclick = () => {
            if (currentChatUser) socket.emit('private_message', { to_user_id: currentChatUser.id, text: s });
            else if (currentGroup) socket.emit('group_message', { group_id: currentGroup.id, text: s });
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
    if (!ind) { ind = document.createElement('div'); ind.className = 'typing-indicator'; messagesListDiv.parentElement.insertBefore(ind, messagesListDiv.parentElement.firstChild); }
    ind.textContent = `${currentChatUser?.username || 'Собеседник'} печатает...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => ind?.remove(), 1500);
}

// ============ НАСТРОЙКИ ==========
const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) settingsBtn.onclick = () => { loadProfile(); settingsPanel.style.display = 'block'; setTimeout(() => settingsPanel.classList.add('open'), 10); if (sidebar.classList.contains('open')) sidebar.classList.remove('open'); };
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
if (closeSettingsBtn) closeSettingsBtn.onclick = () => { settingsPanel.classList.remove('open'); setTimeout(() => settingsPanel.style.display = 'none', 300); };
const themeSelect = document.getElementById('themeSelect');
if (themeSelect) themeSelect.onchange = async (e) => { const theme = e.target.value; document.body.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ theme }) }); };
const fontSizeSlider = document.getElementById('fontSizeSlider');
if (fontSizeSlider) fontSizeSlider.oninput = (e) => { const val = e.target.value; document.getElementById('fontSizeValue').textContent = val; document.body.style.setProperty('--font-size', val + 'px'); localStorage.setItem('fontSize', val); };
const borderRadiusSlider = document.getElementById('borderRadiusSlider');
if (borderRadiusSlider) borderRadiusSlider.oninput = (e) => { const val = e.target.value; document.getElementById('borderRadiusValue').textContent = val; document.body.style.setProperty('--border-radius', val + 'px'); localStorage.setItem('borderRadius', val); };
const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
if (uploadAvatarBtn) uploadAvatarBtn.onclick = async () => { const file = document.getElementById('avatarInput').files[0]; if (!file) return; const fd = new FormData(); fd.append('avatar', file); const res = await fetch('/api/upload-avatar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd }); if (res.ok) { alert('Аватарка обновлена'); loadProfile(); loadUsers(); } };
const updateProfileBtn = document.getElementById('updateProfileBtn');
if (updateProfileBtn) updateProfileBtn.onclick = async () => { const username = document.getElementById('profileUsername').value || null; const bio = document.getElementById('profileBio').value; const birthDate = document.getElementById('profileBirthDate').value; await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ username, bio, birthDate }) }); alert('Профиль сохранен'); if (username) currentUsernameSpan.textContent = username; loadUsers(); };
const showSetPasswordBtn = document.getElementById('showSetPasswordBtn');
if (showSetPasswordBtn) showSetPasswordBtn.onclick = () => document.getElementById('setPasswordDiv').style.display = 'block';
const confirmPasswordBtn = document.getElementById('confirmPasswordBtn');
if (confirmPasswordBtn) confirmPasswordBtn.onclick = async () => { const password = document.getElementById('newPassword').value; await fetch('/api/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ password }) }); alert('Пароль установлен'); document.getElementById('setPasswordDiv').style.display = 'none'; };
async function loadProfile() {
    const res = await fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
    const u = await res.json();
    document.getElementById('profileUsername').value = u.username || '';
    document.getElementById('profileBio').value = u.bio || '';
    document.getElementById('profileBirthDate').value = u.birthDate || '';
    const starsBalance = document.getElementById('starsBalance');
    if (starsBalance) starsBalance.textContent = u.stars || 0;
    const av = document.getElementById('profileAvatar');
    if (av) { if (u.avatar) { av.src = u.avatar; av.style.background = 'none'; av.textContent = ''; } else { av.src = ''; av.style.background = 'linear-gradient(135deg,#8b5cf6,#a78bfa)'; av.textContent = u.username?.[0]?.toUpperCase() || '?'; } }
    updateAvatarElement(currentUserAvatar, u.avatar, u.username);
    if (currentUserStars) currentUserStars.textContent = `⭐ ${u.stars || 0}`;
}
function detectDevice() { const width = window.innerWidth; const isMobile = width < 768; const deviceInfo = document.getElementById('deviceInfo'); if (deviceInfo) deviceInfo.innerHTML = `${isMobile ? '📱 Телефон' : '💻 Компьютер'}<br>${width} × ${window.innerHeight}`; }
detectDevice();
window.addEventListener('resize', detectDevice);

const savedToken = localStorage.getItem('token');
if (savedToken) {
    token = savedToken;
    fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } }).then(res => { if (res.ok) res.json().then(u => { currentUser = u; initMessenger(); }); else localStorage.removeItem('token'); });
}

window.openChatUser = openChatUser;