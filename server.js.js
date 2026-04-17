require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// ============ ВРЕМЕННАЯ БАЗА ДАННЫХ (потом заменим на PostgreSQL) ============
const users = [];        // { id, phone, username, password_hash, avatar, online, last_seen }
const messages = [];     // { id, from_user_id, to_user_id, text, time, is_read }
let nextUserId = 1;
let nextMsgId = 1;

// ============ API ============

// Регистрация
app.post('/api/register', async (req, res) => {
    const { phone, username, password } = req.body;
    
    if (users.find(u => u.phone === phone)) {
        return res.status(400).json({ error: 'Номер уже зарегистрирован' });
    }
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username уже занят' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username только англ. буквы, цифры, _ (3-20 символов)' });
    }
    
    const password_hash = await bcrypt.hash(password, 10);
    const user = {
        id: nextUserId++,
        phone,
        username,
        password_hash,
        avatar: null,
        online: false,
        last_seen: new Date()
    };
    users.push(user);
    
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
});

// Логин
app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    const user = users.find(u => u.phone === phone);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Неверный номер или пароль' });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
});

// Получить всех пользователей (для списка контактов)
app.get('/api/users', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        const otherUsers = users.filter(u => u.id !== userId).map(u => ({
            id: u.id,
            username: u.username,
            avatar: u.avatar,
            online: u.online,
            last_seen: u.last_seen
        }));
        res.json(otherUsers);
    } catch(e) {
        res.status(401).json({ error: 'Неверный токен' });
    }
});

// Получить диалог (историю сообщений с конкретным пользователем)
app.get('/api/messages/:userId', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        const otherUserId = parseInt(req.params.userId);
        
        const dialog = messages.filter(m => 
            (m.from_user_id === userId && m.to_user_id === otherUserId) ||
            (m.from_user_id === otherUserId && m.to_user_id === userId)
        ).sort((a, b) => a.time - b.time);
        
        res.json(dialog);
    } catch(e) {
        res.status(401).json({ error: 'Неверный токен' });
    }
});

// Обновить настройки темы
app.put('/api/settings', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    res.json({ success: true });
});

// ============ SOCKET.IO ============
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = userId;
        next();
    } catch(e) {
        next(new Error('Authentication error'));
    }
});

io.on('connection', (socket) => {
    console.log('✅ Пользователь подключился:', socket.userId);
    
    // Обновляем статус онлайн
    const user = users.find(u => u.id === socket.userId);
    if (user) {
        user.online = true;
        user.last_seen = new Date();
        // Сообщаем всем что пользователь онлайн
        io.emit('user_status', { userId: socket.userId, online: true, last_seen: user.last_seen });
    }
    
    // Отправка личного сообщения
    socket.on('private_message', async (data) => {
        const { to_user_id, text } = data;
        const from_user_id = socket.userId;
        
        const message = {
            id: nextMsgId++,
            from_user_id,
            to_user_id,
            text,
            time: Date.now(),
            is_read: false
        };
        messages.push(message);
        
        // Отправляем отправителю (для отображения в его чате)
        socket.emit('new_message', message);
        
        // Отправляем получателю, если он онлайн
        const recipientSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === to_user_id);
        if (recipientSocket) {
            recipientSocket.emit('new_message', message);
        }
    });
    
    // Пользователь печатает
    socket.on('typing', (to_user_id) => {
        const recipientSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === to_user_id);
        if (recipientSocket) {
            recipientSocket.emit('user_typing', { from_user_id: socket.userId });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Пользователь отключился:', socket.userId);
        const user = users.find(u => u.id === socket.userId);
        if (user) {
            user.online = false;
            user.last_seen = new Date();
            io.emit('user_status', { userId: socket.userId, online: false, last_seen: user.last_seen });
        }
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${process.env.PORT || 3000}`);
});
