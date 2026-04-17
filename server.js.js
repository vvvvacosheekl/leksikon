require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

const resend = new Resend('re_hGMNJ85k_APUywP3t6WePveiPStubUAaZ');

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
app.use('/uploads', express.static('uploads'));

const users = [];
const messages = [];
const groups = [];
let nextUserId = 1;
let nextMsgId = 1;
let nextGroupId = 1;
const emailCodes = {};

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch(e) {
        res.status(401).json({ error: 'Неверный токен' });
    }
};

// ============ ПОЧТА ============
app.post('/api/send-email-code', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    emailCodes[email] = { code, expires: Date.now() + 10 * 60000 };
    try {
        await resend.emails.send({
            from: 'Leksikon <onboarding@resend.dev>',
            to: email,
            subject: 'Код подтверждения Leksikon',
            html: `<h2>Ваш код: ${code}</h2>`
        });
        console.log(`✅ Код ${code} на ${email}`);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

app.post('/api/verify-email-code', (req, res) => {
    const { email, code } = req.body;
    const record = emailCodes[email];
    if (!record) return res.status(400).json({ error: 'Запросите код' });
    if (record.expires < Date.now()) return res.status(400).json({ error: 'Код истек' });
    if (record.code !== code) return res.status(400).json({ error: 'Неверный код' });
    delete emailCodes[email];
    res.json({ success: true, verified: true });
});

// ============ РЕГИСТРАЦИЯ ============
app.post('/api/register', async (req, res) => {
    const { email } = req.body;
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }
    const user = {
        id: nextUserId++, email,
        username: email.split('@')[0],
        avatar: null, online: false, last_seen: new Date(),
        settings: { theme: 'purple', fontSize: 16, borderRadius: 18 },
        stars: 100, gifts: [], bio: null, birthDate: null
    };
    users.push(user);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: null, settings: user.settings, stars: 100 } });
});

// ============ ЛОГИН ============
app.post('/api/login', async (req, res) => {
    const { email, code } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Email не зарегистрирован' });
    const record = emailCodes[email];
    if (!record || record.code !== code || record.expires < Date.now()) {
        return res.status(401).json({ error: 'Неверный код' });
    }
    delete emailCodes[email];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, settings: user.settings, stars: user.stars } });
});

app.post('/api/login-apple', async (req, res) => {
    const { email, name } = req.body;
    if (!email || !email.endsWith('@icloud.com')) {
        return res.status(400).json({ error: 'Используйте Apple ID (@icloud.com)' });
    }
    let user = users.find(u => u.email === email);
    if (!user) {
        user = { id: nextUserId++, email, username: name || email.split('@')[0], avatar: null, online: false, last_seen: new Date(), settings: { theme: 'purple', fontSize: 16, borderRadius: 18 }, stars: 100, gifts: [], bio: null, birthDate: null, appleId: true };
        users.push(user);
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, settings: user.settings, stars: user.stars } });
});

app.post('/api/login-password', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user || !user.hasPassword) return res.status(401).json({ error: 'Неверный email или пароль' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Неверный email или пароль' });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, settings: user.settings, stars: user.stars } });
});

app.post('/api/set-password', authMiddleware, async (req, res) => {
    const user = users.find(u => u.id === req.userId);
    user.password_hash = await bcrypt.hash(req.body.password, 10);
    user.hasPassword = true;
    res.json({ success: true });
});

// ============ ПРОФИЛЬ ============
app.get('/api/profile', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    res.json({ id: user.id, email: user.email, username: user.username, avatar: user.avatar, bio: user.bio, birthDate: user.birthDate, settings: user.settings, stars: user.stars });
});

app.put('/api/profile', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    if (req.body.username !== undefined) user.username = req.body.username;
    if (req.body.bio !== undefined) user.bio = req.body.bio;
    if (req.body.birthDate !== undefined) user.birthDate = req.body.birthDate;
    res.json({ success: true });
});

app.put('/api/settings', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    if (req.body.theme) user.settings.theme = req.body.theme;
    if (req.body.fontSize) user.settings.fontSize = req.body.fontSize;
    if (req.body.borderRadius) user.settings.borderRadius = req.body.borderRadius;
    res.json({ success: true });
});

app.post('/api/upload-avatar', authMiddleware, upload.single('avatar'), (req, res) => {
    const user = users.find(u => u.id === req.userId);
    if (user.avatar && user.avatar.startsWith('/uploads/')) {
        const oldPath = '.' + user.avatar;
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    user.avatar = '/uploads/' + req.file.filename;
    res.json({ success: true, avatarUrl: user.avatar });
});

app.post('/api/upload-file', authMiddleware, upload.single('file'), (req, res) => {
    res.json({ fileUrl: '/uploads/' + req.file.filename, fileType: req.file.mimetype });
});

// ============ ПОЛЬЗОВАТЕЛИ ============
app.get('/api/users', authMiddleware, (req, res) => {
    res.json(users.filter(u => u.id !== req.userId).map(u => ({ id: u.id, username: u.username, avatar: u.avatar, online: u.online, last_seen: u.last_seen })));
});

app.get('/api/messages/:userId', authMiddleware, (req, res) => {
    const otherId = parseInt(req.params.userId);
    const dialog = messages.filter(m => (m.from_user_id === req.userId && m.to_user_id === otherId) || (m.from_user_id === otherId && m.to_user_id === req.userId)).sort((a, b) => a.time - b.time);
    res.json(dialog);
});

app.post('/api/messages/:messageId', authMiddleware, (req, res) => {
    const msg = messages.find(m => m.id === parseInt(req.params.messageId));
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.from_user_id !== req.userId) return res.status(403).json({ error: 'Нельзя редактировать чужое сообщение' });
    msg.text = req.body.text;
    msg.edited = true;
    res.json({ success: true });
});

app.delete('/api/messages/:messageId', authMiddleware, (req, res) => {
    const index = messages.findIndex(m => m.id === parseInt(req.params.messageId));
    if (index === -1) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (messages[index].from_user_id !== req.userId) return res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
    messages.splice(index, 1);
    res.json({ success: true });
});

// ============ ПОИСК ============
app.get('/api/search-user', authMiddleware, (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const results = users.filter(u => u.id !== req.userId && u.username?.toLowerCase().includes(q.toLowerCase())).map(u => ({ id: u.id, username: u.username, email: u.email, avatar: u.avatar, online: u.online }));
    res.json(results.slice(0, 20));
});

// ============ ЗВЕЗДЫ И ПОДАРКИ ============
app.post('/api/buy-stars', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    user.stars += req.body.amount;
    res.json({ stars: user.stars });
});

app.post('/api/send-gift', authMiddleware, (req, res) => {
    const fromUser = users.find(u => u.id === req.userId);
    const toUser = users.find(u => u.id === req.body.to_user_id);
    if (fromUser.stars < req.body.stars_cost) return res.status(400).json({ error: 'Недостаточно звезд' });
    fromUser.stars -= req.body.stars_cost;
    toUser.gifts.push({ from: fromUser.username, type: req.body.gift_type, time: Date.now() });
    io.emit('gift_received', { to_user_id: req.body.to_user_id, from: fromUser.username, gift_type: req.body.gift_type });
    res.json({ success: true });
});

// ============ ГРУППЫ ============
app.post('/api/create-group', authMiddleware, (req, res) => {
    const group = { id: nextGroupId++, name: req.body.name, creator: req.userId, members: [req.userId, ...(req.body.members || [])], messages: [], createdAt: Date.now() };
    groups.push(group);
    res.json({ groupId: group.id });
});

app.get('/api/groups', authMiddleware, (req, res) => {
    res.json(groups.filter(g => g.members.includes(req.userId)));
});

app.get('/api/group-messages/:groupId', authMiddleware, (req, res) => {
    const group = groups.find(g => g.id === parseInt(req.params.groupId));
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    res.json(group.messages.sort((a, b) => a.time - b.time));
});

// ============ SOCKET.IO ============
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = userId;
        next();
    } catch(e) { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
    console.log('✅ Подключился:', socket.userId);
    const user = users.find(u => u.id === socket.userId);
    if (user) { user.online = true; io.emit('user_status', { userId: socket.userId, online: true }); }
    
    socket.on('private_message', (data) => {
        const fromUser = users.find(u => u.id === socket.userId);
        const message = { id: nextMsgId++, from_user_id: socket.userId, to_user_id: data.to_user_id, text: data.text || '', fileUrl: data.fileUrl, fileType: data.fileType, voiceUrl: data.voiceUrl, time: Date.now(), from_username: fromUser?.username, reactions: {} };
        messages.push(message);
        io.emit('new_message', message);
    });
    
    socket.on('group_message', (data) => {
        const group = groups.find(g => g.id === data.group_id);
        if (!group) return;
        const fromUser = users.find(u => u.id === socket.userId);
        const message = { id: nextMsgId++, from_user_id: socket.userId, group_id: data.group_id, text: data.text || '', fileUrl: data.fileUrl, time: Date.now(), from_username: fromUser?.username };
        group.messages.push(message);
        group.members.forEach(memberId => { const ms = [...io.sockets.sockets.values()].find(s => s.userId === memberId); if (ms) ms.emit('group_message', message); });
    });
    
    socket.on('voice_message', async (data) => {
        const fromUser = users.find(u => u.id === socket.userId);
        const message = { id: nextMsgId++, from_user_id: socket.userId, to_user_id: data.to_user_id, voiceUrl: data.voiceUrl, voiceDuration: data.duration, time: Date.now(), from_username: fromUser?.username };
        messages.push(message);
        io.emit('new_message', message);
    });
    
    socket.on('edit_message', ({ messageId, text }) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg && msg.from_user_id === socket.userId) { msg.text = text; msg.edited = true; io.emit('message_edited', { messageId, text }); }
    });
    
    socket.on('delete_message', (messageId) => {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1 && messages[index].from_user_id === socket.userId) { messages.splice(index, 1); io.emit('message_deleted', messageId); }
    });
    
    socket.on('add_reaction', ({ messageId, reaction }) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg) { if (!msg.reactions) msg.reactions = {}; msg.reactions[reaction] = (msg.reactions[reaction] || 0) + 1; io.emit('reaction_update', { messageId, reactions: msg.reactions }); }
    });
    
    socket.on('webrtc_offer', (data) => { const recipient = [...io.sockets.sockets.values()].find(s => s.userId === data.to); if (recipient) recipient.emit('webrtc_offer', { from: socket.userId, offer: data.offer }); });
    socket.on('webrtc_answer', (data) => { const recipient = [...io.sockets.sockets.values()].find(s => s.userId === data.to); if (recipient) recipient.emit('webrtc_answer', { from: socket.userId, answer: data.answer }); });
    socket.on('webrtc_ice', (data) => { const recipient = [...io.sockets.sockets.values()].find(s => s.userId === data.to); if (recipient) recipient.emit('webrtc_ice', { from: socket.userId, candidate: data.candidate }); });
    
    socket.on('typing', () => socket.broadcast.emit('user_typing', { from_user_id: socket.userId }));
    
    socket.on('disconnect', () => { if (user) { user.online = false; user.last_seen = new Date(); io.emit('user_status', { userId: socket.userId, online: false }); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Сервер на http://localhost:${PORT}`));