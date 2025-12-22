require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const multer = require('multer');
const { URLSearchParams } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const ARTICLES_PATH = path.join(__dirname, 'data', 'articles.json');
const TOPICS_PATH = path.join(__dirname, 'data', 'topics.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.png';
        const base = path.basename(file.originalname, ext).replace(/[^\w\u4e00-\u9fa5-]/g, '');
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${base || 'image'}-${unique}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持图片上传'));
        }
    }
});

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
// Simple admin auth middleware
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function requireAdmin(req, res, next) {
    if (!ADMIN_TOKEN) return res.status(500).json({ message: 'ADMIN_TOKEN is not set on server' });
    const token = req.headers['x-admin-token'] || req.query.token;
    if (token && token === ADMIN_TOKEN) return next();
    return res.status(401).json({ message: 'Unauthorized' });
}

// gate admin page before static
app.use((req, res, next) => {
    if (req.path === '/admin.html') {
        return requireAdmin(req, res, next);
    }
    next();
});

// SSR 注入文章分享 meta，保证爬虫无需执行 JS 也能拿到封面等信息
app.get('/article.html', async (req, res, next) => {
    const articleId = req.query.id;
    if (!articleId) {
        return res.sendFile(path.join(__dirname, 'article.html'));
    }
    try {
        const articles = await readArticles();
        const article = articles.find(item => item.id === articleId);
        if (!article) {
            return res.sendFile(path.join(__dirname, 'article.html'));
        }
        const htmlPath = path.join(__dirname, 'article.html');
        let html = await fs.readFile(htmlPath, 'utf-8');
        const absoluteUrl = (url) => {
            if (!url) return '';
            try {
                return new URL(url, `${req.protocol}://${req.get('host')}`).toString();
            } catch (e) {
                return '';
            }
        };
        const shareUrl = absoluteUrl(req.originalUrl);
        const cover = absoluteUrl(article.cover) || 'https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=1200&q=80';
        const summary = article.summary || '多语言 Polymarket 学习教程';
        const replaceMeta = (prop, value, attr = 'property') => {
            if (!value) return;
            const pattern = new RegExp(`(<meta\\s+${attr}=["']${prop}["'][^>]*content=["'])[\\s\\S]*?(["'])`, 'i');
            html = html.replace(pattern, `$1${value}$2`);
        };
        replaceMeta('og:title', article.title || 'Polymarket start engine');
        replaceMeta('og:description', summary);
        replaceMeta('og:image', cover);
        replaceMeta('og:image:secure_url', cover);
        replaceMeta('og:image:alt', article.title || '文章封面');
        replaceMeta('og:image:width', '1200');
        replaceMeta('og:image:height', '630');
        replaceMeta('og:url', shareUrl);
        replaceMeta('twitter:title', article.title || 'Polymarket start engine', 'name');
        replaceMeta('twitter:description', summary, 'name');
        replaceMeta('twitter:image', cover, 'name');
        replaceMeta('twitter:image:alt', article.title || '文章封面', 'name');

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        next(error);
    }
});

app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// Protect admin page
app.get('/admin.html', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

async function ensureFile(filePath, defaultContent = '[]') {
    try {
        await fs.access(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, defaultContent, 'utf-8');
            return;
        }
        throw error;
    }
}

async function readArticles() {
    await ensureFile(ARTICLES_PATH);
    const raw = await fs.readFile(ARTICLES_PATH, 'utf-8');
    return JSON.parse(raw);
}

async function writeArticles(articles) {
    await fs.writeFile(ARTICLES_PATH, JSON.stringify(articles, null, 2), 'utf-8');
}

async function readTopics() {
    await ensureFile(TOPICS_PATH);
    const raw = await fs.readFile(TOPICS_PATH, 'utf-8');
    const topics = JSON.parse(raw);
    return topics.map((topic, index) => ({
        ...topic,
        order: typeof topic.order === 'number' ? topic.order : index + 1,
    }));
}

async function writeTopics(topics) {
    await fs.writeFile(TOPICS_PATH, JSON.stringify(topics, null, 2), 'utf-8');
}

function slugify(text) {
    return text
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function parseContentBlocks(raw = '') {
    if (!raw.trim()) {
        return [];
    }

    return raw
        .split(/\n{2,}/)
        .map(section => section.trim())
        .filter(Boolean)
        .map((section, index) => {
            const lines = section.split('\n');
            let heading = `段落 ${index + 1}`;
            if (/^#+\s+/.test(lines[0])) {
                heading = lines[0].replace(/^#+\s*/, '') || heading;
                lines.shift();
            }
            const body = lines.join('\n').trim() || section;
            return { heading, body };
        });
}

app.get('/api/articles', async (req, res, next) => {
    try {
        const articles = await readArticles();
        res.json(articles);
    } catch (error) {
        next(error);
    }
});

app.get('/api/topics', async (req, res, next) => {
    try {
        const [topics, articles] = await Promise.all([readTopics(), readArticles()]);
        const statsMap = articles.reduce((acc, article) => {
            if (!article.topic) return acc;
            if (!acc[article.topic]) {
                acc[article.topic] = { count: 0, latestUpdated: null };
            }
            acc[article.topic].count += 1;
            const updatedAt = new Date(article.updated || 0).getTime();
            const stored = new Date(acc[article.topic].latestUpdated || 0).getTime();
            if (updatedAt > stored) {
                acc[article.topic].latestUpdated = article.updated;
            }
            return acc;
        }, {});

        const enriched = topics.map(topic => ({
            ...topic,
            count: statsMap[topic.id]?.count || 0,
            latestUpdated: statsMap[topic.id]?.latestUpdated || null,
        })).sort((a, b) => a.order - b.order);

        res.json(enriched);
    } catch (error) {
        next(error);
    }
});

app.post('/api/uploads', upload.single('image'), (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: '未检测到文件' });
        }
        const fileUrl = `/uploads/${req.file.filename}`;
        res.status(201).json({ url: fileUrl });
    } catch (error) {
        next(error);
    }
});

app.post('/api/topics', async (req, res, next) => {
    try {
        const { id, label, description = '' } = req.body;
        if (!id || !label) {
            return res.status(400).json({ message: '专题 ID 和名称为必填项' });
        }

        if (!/^[a-z0-9-]+$/i.test(id)) {
            return res.status(400).json({ message: '专题 ID 仅能包含字母、数字或短横线' });
        }

        const topics = await readTopics();
        if (topics.some(topic => topic.id === id)) {
            return res.status(409).json({ message: '该专题 ID 已存在' });
        }

        const maxOrder = topics.reduce((max, t) => Math.max(max, t.order || 0), 0);
        const newTopic = { id, label, description, order: maxOrder + 1 };
        topics.push(newTopic);
        await writeTopics(topics);
        res.status(201).json(newTopic);
    } catch (error) {
        next(error);
    }
});

app.put('/api/topics/order', async (req, res, next) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order) || !order.length) {
            return res.status(400).json({ message: '请提供新的排序数组' });
        }

        const topics = await readTopics();
        const orderMap = new Map(order.map((id, idx) => [id, idx + 1]));
        const updated = topics.map(topic => ({
            ...topic,
            order: orderMap.get(topic.id) || topic.order,
        }));
        await writeTopics(updated);
        res.json({ updated: true });
    } catch (error) {
        next(error);
    }
});

app.post('/api/translate', async (req, res, next) => {
    try {
        const { q, target, source = 'auto', format = 'text' } = req.body || {};
        if (!q || !target) {
            return res.status(400).json({ message: '缺少必要参数 q 或 target' });
        }
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: '缺少 GOOGLE_API_KEY 环境变量' });
        }
        const endpoint = 'https://translation.googleapis.com/language/translate/v2';
        const params = new URLSearchParams({ target, format, key: apiKey });
        if (Array.isArray(q)) {
            q.forEach(item => params.append('q', item));
        } else {
            params.append('q', q);
        }
        if (source && source !== 'auto') {
            params.append('source', source);
        }

        const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        const text = await upstream.text();
        if (!upstream.ok) {
            console.error('Translate API upstream error', upstream.status, text);
            return res.status(502).json({
                message: '翻译服务返回错误',
                detail: text.slice(0, 400),
                status: upstream.status
            });
        }
        const data = JSON.parse(text);
        const translations = data?.data?.translations;
        if (!Array.isArray(translations) || !translations.length) {
            console.error('Translate API empty result', text);
            return res.status(502).json({ message: '翻译结果为空', detail: text.slice(0, 400) });
        }
        // 兼容单条和多条
        if (translations.length === 1) {
            return res.json({ translatedText: translations[0]?.translatedText });
        }
        res.json({ data: { translations } });
    } catch (error) {
        next(error);
    }
});

app.get('/api/articles/:id', async (req, res, next) => {
    try {
        const articles = await readArticles();
        const article = articles.find(item => item.id === req.params.id);
        if (!article) {
            return res.status(404).json({ message: '未找到对应文章' });
        }
        res.json(article);
    } catch (error) {
        next(error);
    }
});

app.delete('/api/articles/:id', async (req, res, next) => {
    try {
        const id = req.params.id;
        console.log('DELETE /api/articles/:id', id);
        const articles = await readArticles();
        const idx = articles.findIndex(item => item.id === id);
        if (idx === -1) {
            return res.status(404).json({ message: '未找到对应文章' });
        }
        articles.splice(idx, 1);
        await writeArticles(articles);
        res.json({ deleted: id });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/topics/:topicId', async (req, res, next) => {
    try {
        const topicId = req.params.topicId;
        const [topics, articles] = await Promise.all([readTopics(), readArticles()]);
        const topicIndex = topics.findIndex(topic => topic.id === topicId);
        if (topicIndex === -1) {
            return res.status(404).json({ message: '未找到对应专题' });
        }

        topics.splice(topicIndex, 1);
        const remainingArticles = articles.filter(article => article.topic !== topicId);

        await Promise.all([
            writeTopics(topics),
            writeArticles(remainingArticles),
        ]);

        res.json({ deleted: articles.length - remainingArticles.length });
    } catch (error) {
        next(error);
    }
});

app.post('/api/articles', async (req, res, next) => {
    try {
        const {
            title,
            summary,
            topic,
            duration,
            updated,
            cover,
            tags = [],
            takeaways = [],
            content,
            author = {},
            topicLabel,
        } = req.body;

        if (!title || !summary || !topic || !content) {
            return res.status(400).json({ message: '请提供完整的标题、摘要、专题与内容' });
        }

        const [articles, topics] = await Promise.all([readArticles(), readTopics()]);
        const matchedTopic = topics.find(item => item.id === topic);
        if (!matchedTopic) {
            return res.status(400).json({ message: '专题不存在，请在专题管理中创建后再使用' });
        }

        const normalizedId = slugify(req.body.id || title) || `article-${Date.now()}`;

        if (articles.some(item => item.id === normalizedId)) {
            return res.status(409).json({ message: '存在同名文章，请修改标题或指定自定义 ID' });
        }

        const category = topicLabel || matchedTopic.label || '自定义专栏';
        const parsedTakeaways = Array.isArray(takeaways)
            ? takeaways
            : String(takeaways || '')
                .split(/\n|,/)
                .map(item => item.trim())
                .filter(Boolean);

        const newArticle = {
            id: normalizedId,
            title,
            summary,
            topic,
            category,
            duration: duration || '5 分钟阅读',
            updated: updated || new Date().toISOString().slice(0, 10),
            cover: cover || 'https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=1400&q=80',
            content,
            author: {
                name: author.name || '内容团队',
                role: author.role || '专栏作者',
                initials: (author.name || 'AI').slice(0, 2).toUpperCase()
            },
            tags,
            takeaways: parsedTakeaways,
            contentBlocks: parseContentBlocks(content)
        };

        articles.push(newArticle);
        await writeArticles(articles);

        res.status(201).json(newArticle);
    } catch (error) {
        next(error);
    }
});

app.put('/api/articles/:id', async (req, res, next) => {
    try {
        const {
            title,
            summary,
            topic,
            duration,
            updated,
            cover,
            tags = [],
            takeaways = [],
            content,
            author = {},
            topicLabel,
        } = req.body;

        if (!title || !summary || !topic || !content) {
            return res.status(400).json({ message: '请提供完整的标题、摘要、专题与内容' });
        }

        const [articles, topics] = await Promise.all([readArticles(), readTopics()]);
        const matchedTopic = topics.find(item => item.id === topic);
        if (!matchedTopic) {
            return res.status(400).json({ message: '专题不存在，请在专题管理中创建后再使用' });
        }

        const idx = articles.findIndex(item => item.id === req.params.id);
        if (idx === -1) {
            return res.status(404).json({ message: '未找到对应文章' });
        }

        const category = topicLabel || matchedTopic.label || articles[idx].category || '自定义专栏';
        const parsedTakeaways = Array.isArray(takeaways)
            ? takeaways
            : String(takeaways || '')
                .split(/\n|,/)
                .map(item => item.trim())
                .filter(Boolean);

        const updatedArticle = {
            ...articles[idx],
            title,
            summary,
            topic,
            category,
            duration: duration || '5 分钟阅读',
            updated: updated || new Date().toISOString().slice(0, 10),
            cover: cover || articles[idx].cover,
            content,
            author: {
                name: author.name || '内容团队',
                role: author.role || '专栏作者',
                initials: (author.name || 'AI').slice(0, 2).toUpperCase()
            },
            tags,
            takeaways: parsedTakeaways,
            contentBlocks: parseContentBlocks(content)
        };

        articles[idx] = updatedArticle;
        await writeArticles(articles);
        res.json(updatedArticle);
    } catch (error) {
        next(error);
    }
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: '服务器内部错误', detail: err.message });
});

app.listen(PORT, () => {
    console.log(`Polywise server running at http://localhost:${PORT}`);
});
