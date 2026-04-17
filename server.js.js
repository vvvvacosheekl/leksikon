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
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    allowEIO3: true
});

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
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
app.use('/uploads', express.static('uploads'));

const users = [];
const messages = [];
let nextUserId = 1;
let nextMsgId = 1;
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

app.post('/api/register', async (req, res) => {
    const { email } = req.body;
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }
    const user = {
        id: nextUserId++, email, username: null, hasPassword: false, password_hash: null,
        avatar: null, online: false, last_seen: new Date(),
        settings: { theme: 'purple', fontSize: 16, borderRadius: 18, privacy: { emailVisible: 'everyone' } },
        stars: 100, gifts: [], bio: null, birthDate: null
    };
    users.push(user);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: null, avatar: null, settings: user.settings, hasPassword: false, stars: 100 } });
});

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
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, settings: user.settings, hasPassword: user.hasPassword, stars: user.stars } });
});

app.post('/api/login-password', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (!user || !user.hasPassword) return res.status(401).json({ error: 'Неверный email или пароль' });
    if (!await bcrypt.compare(password, user.password_hash)) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, settings: user.settings, hasPassword: true, stars: user.stars } });
});

app.post('/api/set-password', authMiddleware, async (req, res) => {
    const user = users.find(u => u.id === req.userId);
    user.password_hash = await bcrypt.hash(req.body.password, 10);
    user.hasPassword = true;
    res.json({ success: true });
});

app.get('/api/profile', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    res.json({ id: user.id, email: user.email, username: user.username, avatar: user.avatar, bio: user.bio, birthDate: user.birthDate, settings: user.settings, hasPassword: user.hasPassword, stars: user.stars });
});

app.put('/api/profile', authMiddleware, (req, res) => {
    const user = users.find(u => u.id === req.userId);
    const { username, bio, birthDate } = req.body;
    if (username !== undefined) user.username = username;
    if (bio !== undefined) user.bio = bio;
    if (birthDate !== undefined) user.birthDate = birthDate;
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

app.get('/api/users', authMiddleware, (req, res) => {
    const otherUsers = users.filter(u => u.id !== req.userId).map(u => ({
        id: u.id, username: u.username || u.email.split('@')[0], avatar: u.avatar,
        online: u.online, last_seen: u.last_seen
    }));
    res.json(otherUsers);
});

app.get('/api/messages/:userId', authMiddleware, (req, res) => {
    const otherId = parseInt(req.params.userId);
    const dialog = messages.filter(m =>
        (m.from_user_id === req.userId && m.to_user_id === otherId) ||
        (m.from_user_id === otherId && m.to_user_id === req.userId)
    ).sort((a, b) => a.time - b.time);
    res.json(dialog);
});

// ============ SOCKET.IO ============
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Auth error'));
    try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = userId;
        next();
    } catch(e) { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
    console.log('✅ Подключился:', socket.userId);
    
    const user = users.find(u => u.id === socket.userId);
    if (user) {
        user.online = true;
        io.emit('user_status', { userId: socket.userId, online: true });
    }
    
    socket.on('private_message', (data) => {
        console.log('📨 Сообщение от', socket.userId, 'для', data.to_user_id);
        const fromUser = users.find(u => u.id === socket.userId);
        const message = {
            id: nextMsgId++,
            from_user_id: socket.userId,
            to_user_id: data.to_user_id,
            text: data.text || '',
            fileUrl: data.fileUrl,
            fileType: data.fileType,
            time: Date.now(),
            from_username: fromUser?.username || fromUser?.email?.split('@')[0],
            reactions: {}
        };
        messages.push(message);
        io.emit('new_message', message);
        console.log('📤 Сообщение разослано всем');
    });
    
    socket.on('typing', (to_user_id) => {
        socket.broadcast.emit('user_typing', { from_user_id: socket.userId });
    });
    
    socket.on('disconnect', () => {
        console.log('❌ Отключился:', socket.userId);
        if (user) {
            user.online = false;
            user.last_seen = new Date();
            io.emit('user_status', { userId: socket.userId, online: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер на http://localhost:${PORT}`);
});