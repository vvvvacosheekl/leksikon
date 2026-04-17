let socket, token, currentUser;
let currentChatUser = null;
let allUsers = [];

// DOM элементы
const authScreen = document.getElementById('authScreen');
const messengerScreen = document.getElementById('messengerScreen');
const usersListDiv = document.getElementById('usersList');
const messagesListDiv = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatUsernameSpan = document.getElementById('chatUsername');
const chatStatusSpan = document.getElementById('chatStatus');
const currentUsernameSpan = document.getElementById('currentUsername');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const settingsPanel = document.getElementById('settingsPanel');

// ============ АВТОРИЗАЦИЯ ============
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}Form`).classList.add('active');
    });
});

// Регистрация
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('regPhone').value;
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, username, password })
    });
    const data = await res.json();
    if (res.ok) {
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        initMessenger();
    } else {
        alert('Ошибка: ' + data.error);
    }
});

// Логин
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('loginPhone').value;
    const password = document.getElementById('loginPassword').value;
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
    });
    const data = await res.json();
    if (res.ok) {
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        initMessenger();
    } else {
        alert('Ошибка: ' + data.error);
    }
});

// ============ ОСНОВНОЙ МЕССЕНДЖЕР ============
async function initMessenger() {
    authScreen.style.display = 'none';
    messengerScreen.style.display = 'block';
    
    currentUsernameSpan.textContent = currentUser.username;
    if (currentUserAvatar) {
        currentUserAvatar.textContent = currentUser.username[0].toUpperCase();
    }
    
    await loadUsers();
    
    socket = io({ auth: { token } });
    
    socket.on('new_message', (message) => {
        if (currentChatUser && message.from_user_id === currentChatUser.id) {
            appendMessage(message, false);
        }
        loadUsers();
    });
    
    socket.on('user_status', ({ userId, online, last_seen }) => {
        const user = allUsers.find(u => u.id === userId);
        if (user) {
            user.online = online;
            user.last_seen = last_seen;
            if (currentChatUser && currentChatUser.id === userId) {
                updateChatStatus(online);
            }
            renderUsersList();
        }
    });
    
    socket.on('user_typing', ({ from_user_id }) => {
        if (currentChatUser && currentChatUser.id === from_user_id) {
            showTypingIndicator();
            setTimeout(hideTypingIndicator, 1500);
        }
    });
    
    if (sendBtn) {
        sendBtn.onclick = sendMessage;
    }
    if (messageInput) {
        messageInput.onkeypress = (e) => {
            if (e.key === 'Enter') sendMessage();
            if (currentChatUser) {
                socket.emit('typing', currentChatUser.id);
            }
        };
    }
}

async function loadUsers() {
    const res = await fetch('/api/users', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    allUsers = await res.json();
    renderUsersList();
}

function renderUsersList() {
    if (!usersListDiv) return;
    usersListDiv.innerHTML = '';
    allUsers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        if (currentChatUser && currentChatUser.id === user.id) {
            div.classList.add('active');
        }
        div.innerHTML = '<div class="avatar">' + user.username[0].toUpperCase() + '</div>' +
            '<div class="user-info">' +
                '<div class="user-name">' + user.username + '</div>' +
                '<div class="user-status">' + (user.online ? 'Онлайн' : 'Не в сети') + '</div>' +
            '</div>' +
            '<span class="status-dot ' + (user.online ? 'online' : 'offline') + '"></span>';
        div.onclick = (function(u) { return function() { openChat(u); }; })(user);
        usersListDiv.appendChild(div);
    });
}

async function openChat(user) {
    currentChatUser = user;
    chatUsernameSpan.textContent = user.username;
    updateChatStatus(user.online);
    
    const res = await fetch('/api/messages/' + user.id, {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const messages = await res.json();
    
    messagesListDiv.innerHTML = '';
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        appendMessage(msg, msg.from_user_id === currentUser.id);
    }
    
    renderUsersList();
}

function updateChatStatus(online) {
    if (chatStatusSpan) {
        chatStatusSpan.className = 'status-dot ' + (online ? 'online' : 'offline');
    }
}

function appendMessage(msg, isMy) {
    const div = document.createElement('div');
    div.className = 'message ' + (isMy ? 'my' : '');
    const time = new Date(msg.time).toLocaleTimeString();
    div.innerHTML = '<div>' + msg.text + '</div>' +
        '<small class="message-time">' + time + '</small>';
    messagesListDiv.appendChild(div);
    messagesListDiv.parentElement.scrollTop = messagesListDiv.parentElement.scrollHeight;
}

function sendMessage() {
    if (!currentChatUser) {
        alert('Выберите собеседника');
        return;
    }
    const text = messageInput.value.trim();
    if (!text) return;
    
    socket.emit('private_message', {
        to_user_id: currentChatUser.id,
        text: text
    });
    
    appendMessage({ text: text, time: Date.now() }, true);
    messageInput.value = '';
}

let typingTimeout;
function showTypingIndicator() {
    let indicator = document.querySelector('.typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        messagesListDiv.parentElement.insertBefore(indicator, messagesListDiv.parentElement.firstChild);
    }
    if (currentChatUser) {
        indicator.textContent = currentChatUser.username + ' печатает...';
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTypingIndicator, 1500);
}

function hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
}

// ============ НАСТРОЙКИ ============
const settingsSidebarBtn = document.getElementById('settingsSidebarBtn');
if (settingsSidebarBtn) {
    settingsSidebarBtn.onclick = function() {
        if (settingsPanel) settingsPanel.style.display = 'block';
    };
}
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
if (closeSettingsBtn) {
    closeSettingsBtn.onclick = function() {
        if (settingsPanel) settingsPanel.style.display = 'none';
    };
}

function applySettings(settings) {
    document.body.setAttribute('data-theme', settings.theme || 'dark');
    document.body.style.setProperty('--font-size', (settings.fontSize || 16) + 'px');
    document.body.style.setProperty('--border-radius', (settings.borderRadius || 12) + 'px');
}

const themeSelect = document.getElementById('themeSelect');
if (themeSelect) {
    themeSelect.onchange = async function() {
        const theme = themeSelect.value;
        document.body.setAttribute('data-theme', theme);
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ theme: theme })
        });
    };
}

const fontSizeSlider = document.getElementById('fontSizeSlider');
if (fontSizeSlider) {
    fontSizeSlider.oninput = function(e) {
        const val = e.target.value;
        const fontSizeValue = document.getElementById('fontSizeValue');
        if (fontSizeValue) fontSizeValue.textContent = val;
        document.body.style.setProperty('--font-size', val + 'px');
    };
}

const borderRadiusSlider = document.getElementById('borderRadiusSlider');
if (borderRadiusSlider) {
    borderRadiusSlider.oninput = function(e) {
        const val = e.target.value;
        const borderRadiusValue = document.getElementById('borderRadiusValue');
        if (borderRadiusValue) borderRadiusValue.textContent = val;
        document.body.style.setProperty('--border-radius', val + 'px');
    };
}

// Проверяем сохраненный токен
const savedToken = localStorage.getItem('token');
if (savedToken) {
    token = savedToken;
    fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(res) {
            if (res.ok) {
                currentUser = { username: 'Загрузка...' };
                initMessenger();
            } else {
                localStorage.removeItem('token');
            }
        });
}
