const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'kgpconnect.sqlite'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== CREATE TABLES =====

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name       TEXT NOT NULL,
    email           TEXT UNIQUE,
    password_hash   TEXT,
    phone           TEXT UNIQUE,
    department      TEXT,
    grad_year       TEXT,
    roll_number     TEXT,
    bio             TEXT,
    interests       TEXT,
    avatar_color    TEXT DEFAULT 'from-blue-400 to-blue-600',
    is_verified     INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    code        TEXT NOT NULL,
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS email_otp_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    code        TEXT NOT NULL,
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS articles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    title           TEXT NOT NULL,
    excerpt         TEXT NOT NULL,
    content         TEXT NOT NULL,
    topic           TEXT NOT NULL,
    cover_image     TEXT,
    author_name     TEXT NOT NULL,
    author_dept     TEXT DEFAULT 'KGPian',
    author_avatar   TEXT DEFAULT 'from-blue-400 to-blue-600',
    author_image    TEXT,
    read_time       TEXT DEFAULT '5 min',
    likes           INTEGER DEFAULT 0,
    comments        INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id      INTEGER NOT NULL,
    parent_id       INTEGER,
    user_id         INTEGER,
    author_name     TEXT NOT NULL,
    author_dept     TEXT DEFAULT 'KGPian',
    author_avatar   TEXT DEFAULT 'from-blue-400 to-blue-600',
    author_image    TEXT,
    content         TEXT NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS article_likes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id      INTEGER NOT NULL,
    user_key        TEXT NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(article_id, user_key),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_articles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    article_id      INTEGER NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, article_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_phone      ON users(phone);
  CREATE INDEX IF NOT EXISTS idx_otp_phone        ON otp_codes(phone);
  CREATE INDEX IF NOT EXISTS idx_email_otp_email  ON email_otp_codes(email);
  CREATE INDEX IF NOT EXISTS idx_articles_topic   ON articles(topic);
  CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id);
`);

// Safe migrations for existing databases
try { db.exec(`ALTER TABLE users ADD COLUMN profile_image TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN cover_image TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE articles ADD COLUMN author_image TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE comments ADD COLUMN parent_id INTEGER`); } catch (e) {}

// Seed initial community articles if empty
const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
if (articleCount === 0) {
  const initialArticles = [
    {
      title: "Attention Is All You Need — But Is It? Revisiting Efficient Alternatives to Transformers",
      excerpt: "An exploration of Mamba, RWKV, and linear attention models that challenge the transformer's dominance in sequence modeling. We benchmark performance on KGP's internal NLP datasets.",
      content: `<p>The transformer architecture has dominated the AI landscape since 2017, but recent innovations suggest we may be at an inflection point. In this article, we explore three promising alternatives that challenge the transformer's computational bottleneck.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">The Quadratic Problem</h3>
      <p>Standard self-attention scales quadratically with sequence length — O(n²) — making it prohibitively expensive for long documents, genomic sequences, and real-time applications.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Mamba: Selective State Spaces</h3>
      <p>Mamba introduces a selection mechanism into state space models (SSMs), allowing the model to dynamically filter information based on input content. Our benchmarks on the KGP NLP corpus show Mamba achieving 94% of GPT-2's perplexity at 3x throughput on sequences of 8K tokens.</p>
      <pre class="bg-slate-950/90 border border-white/10 rounded-xl p-4 my-4 overflow-x-auto text-xs font-mono text-emerald-300"><code>import torch
from mamba_ssm import Mamba

batch, length, dim = 2, 8192, 512
x = torch.randn(batch, length, dim).to("cuda")
model = Mamba(d_model=dim, d_state=16, d_conv=4, expand=2).to("cuda")
y = model(x)</code></pre>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Key Takeaways</h3>
      <ul class="list-disc list-inside space-y-2">
        <li>Linear attention and SSMs offer compelling tradeoffs for latency-sensitive applications</li>
        <li>Hybrid architectures (transformer + SSM layers) may be the future</li>
        <li>For most practical KGP research projects, transformers remain the safe choice — for now</li>
      </ul>`,
      author_name: "Vikram Iyer",
      author_dept: "CSE '26",
      author_avatar: "from-violet-400 to-violet-600",
      read_time: "8 min",
      topic: "LLM",
      likes: 87,
      comments: 23
    },
    {
      title: "Zero-Shot Object Detection with Grounding DINO: A Practical Guide",
      excerpt: "How to build a zero-shot detection pipeline using Grounding DINO and SAM2 — no labeled data needed. Tested on campus surveillance footage for smart campus research.",
      content: `<p>Object detection traditionally requires thousands of labeled examples. Grounding DINO changes this by accepting natural language prompts to detect arbitrary objects — zero-shot.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Architecture Overview</h3>
      <p>Grounding DINO combines a text encoder (BERT) with a visual backbone (Swin Transformer) through cross-modality fusion. It outputs bounding boxes for any text-described object.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Our Campus Experiment</h3>
      <p>We deployed a Grounding DINO + SAM2 pipeline on IIT KGP's campus footage to detect and segment bicycles, pedestrians, and stray animals — achieving 82% mAP without any fine-tuning.</p>`,
      author_name: "Ananya Roy",
      author_dept: "ECE '27",
      author_avatar: "from-cyan-400 to-cyan-600",
      read_time: "10 min",
      topic: "Computer Vision",
      likes: 64,
      comments: 18
    },
    {
      title: "Building a Real-Time Feature Store with Apache Kafka and Redis",
      excerpt: "A step-by-step guide to building a low-latency feature store for ML inference, handling 10K+ requests/sec — architecture inspired by our placement prep platform.",
      content: `<p>Feature stores bridge the gap between data engineering and ML. In this guide, we build one that serves features in under 5ms for real-time model inference.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Architecture</h3>
      <p>Our stack: Kafka for event streaming, Flink for real-time feature computation, Redis for low-latency serving, and a PostgreSQL offline store for batch training.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Results</h3>
      <p>P99 latency of 4.2ms at 10K RPS on a 3-node cluster. Total cost: ~$50/month on AWS spot instances.</p>`,
      author_name: "Karthik Nair",
      author_dept: "CSE '25",
      author_avatar: "from-amber-400 to-amber-600",
      read_time: "15 min",
      topic: "Data Engineering",
      likes: 53,
      comments: 11
    },
    {
      title: "Fine-Tuning LLaMA 3.2 on Custom Datasets with QLoRA: Lessons Learned",
      excerpt: "We fine-tuned LLaMA 3.2 8B on KGP course notes for an AI teaching assistant. Here's what worked, what didn't, and the hyperparameters that matter.",
      content: `<p>Building a course-specific AI tutor requires fine-tuning on domain data. We share our journey of adapting LLaMA 3.2 for IIT KGP's CS curriculum.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Data Preparation</h3>
      <p>We curated 2,500 Q&A pairs from CS course notes, past papers, and professor slides. Data quality > quantity was our core insight.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Training Setup</h3>
      <p>QLoRA with rank 64, alpha 128, on a single A100 40GB GPU. Training converged in 3 epochs (~2 hours). Total compute cost: ₹500 on a cloud GPU.</p>`,
      author_name: "Deepika Singh",
      author_dept: "CSE '26",
      author_avatar: "from-violet-400 to-violet-600",
      read_time: "12 min",
      topic: "LLM",
      likes: 112,
      comments: 34
    },
    {
      title: "Multi-Agent Systems for Automated Code Review: An Experiment",
      excerpt: "We built a multi-agent system where specialized AI agents review code for style, security, and performance — tested on 200+ pull requests from KGP open-source projects.",
      content: `<p>Can AI agents collaborate to review code as effectively as a senior developer? We built a system to find out.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Agent Architecture</h3>
      <p>Three specialized agents: StyleAgent (PEP8/ESLint compliance), SecurityAgent (vulnerability scanning), and PerfAgent (algorithmic complexity analysis). An Orchestrator agent synthesizes their findings.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Results</h3>
      <p>On 200 PRs from KGP GitHub repos: caught 73% of issues that human reviewers found, plus identified 15 security vulnerabilities that were previously missed.</p>`,
      author_name: "Amit Patel",
      author_dept: "CSE '27",
      author_avatar: "from-rose-400 to-rose-600",
      read_time: "9 min",
      topic: "Agentic AI",
      likes: 91,
      comments: 27
    },
    {
      title: "Diffusion Models for Scientific Image Super-Resolution",
      excerpt: "Applying latent diffusion models to enhance microscopy images from the KGP biotech labs — achieving 4x super-resolution with physically consistent outputs.",
      content: `<p>Low-resolution microscopy images limit biological research. We applied diffusion-based super-resolution to enhance images from IIT KGP's biotech labs.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Method</h3>
      <p>We adapted Stable Diffusion's latent space with a custom conditioning mechanism that preserves physical structures in microscopy data.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Results</h3>
      <p>4x super-resolution with SSIM of 0.94 and PSNR of 32.1 dB. Biologists confirmed structural fidelity in 96% of enhanced images.</p>`,
      author_name: "Riya Chatterjee",
      author_dept: "BT '26",
      author_avatar: "from-emerald-400 to-emerald-600",
      read_time: "11 min",
      topic: "Computer Vision",
      likes: 45,
      comments: 8
    },
    {
      title: "Gradient Boosting vs. Neural Networks: When to Use What",
      excerpt: "A practical comparison of XGBoost, LightGBM and simple neural nets on tabular data from KGP's placement prediction dataset. Spoiler: trees still win (mostly).",
      content: `<p>The ML community often defaults to deep learning. But for tabular data, gradient-boosted trees frequently outperform neural networks. We test this on real KGP placement data.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Experiment Setup</h3>
      <p>Dataset: 5,000 anonymized placement records with 45 features (CGPA, department, internships, skills, etc.). Task: predict placement outcome and package.</p>
      <h3 class="text-xl font-bold text-white mt-8 mb-4">Key Findings</h3>
      <ul class="list-disc list-inside space-y-2">
        <li>XGBoost: 89.2% accuracy, 3 seconds training</li>
        <li>LightGBM: 89.5% accuracy, 1.2 seconds training</li>
        <li>3-layer MLP: 87.1% accuracy, 45 seconds training</li>
        <li>TabNet: 88.8% accuracy, 120 seconds training</li>
      </ul>`,
      author_name: "Saurabh Jha",
      author_dept: "MA '26",
      author_avatar: "from-blue-400 to-blue-600",
      read_time: "7 min",
      topic: "Machine Learning",
      likes: 76,
      comments: 19
    }
  ];

  const insertStmt = db.prepare(`
    INSERT INTO articles (title, excerpt, content, topic, author_name, author_dept, author_avatar, read_time, likes, comments)
    VALUES (@title, @excerpt, @content, @topic, @author_name, @author_dept, @author_avatar, @read_time, @likes, @comments)
  `);
  const seedTx = db.transaction((items) => {
    for (const item of items) insertStmt.run(item);
  });
  seedTx(initialArticles);
  console.log('🌱 Seeded initial community articles.');
}

// Seed initial sample comments if empty
const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;
if (commentCount === 0) {
  const firstArticle = db.prepare('SELECT id FROM articles ORDER BY id ASC LIMIT 1').get();
  if (firstArticle) {
    const insertComment = db.prepare(`
      INSERT INTO comments (article_id, author_name, author_dept, author_avatar, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertComment.run(firstArticle.id, 'Rohan Verma', "CSE '27", 'from-cyan-400 to-cyan-600', 'Great benchmark on the KGP NLP corpus! Did you test Mamba-2 with FlashAttention-2 enabled as well?');
    insertComment.run(firstArticle.id, 'Sneha Gupta', "ECE '26", 'from-rose-400 to-rose-600', 'Super clear explanation of selective state spaces. Sharing this with our AI research group!');
  }
}

// Ensure initial "Read Stories" inspiring stories exist in DB
const storiesCount = db.prepare(`SELECT COUNT(*) as count FROM articles WHERE topic = 'Read Stories'`).get().count;
if (storiesCount === 0) {
  const insertStory = db.prepare(`
    INSERT INTO articles (title, excerpt, content, topic, author_name, author_dept, author_avatar, read_time, likes, comments)
    VALUES (@title, @excerpt, @content, @topic, @author_name, @author_dept, @author_avatar, @read_time, @likes, @comments)
  `);
  insertStory.run({
    title: "From Failing My First Semester Coding Test to Research Intern at MIT: My KGP Journey",
    excerpt: "In my first year at IIT Kharagpur, I barely passed PDS. Here is the honest story of how late-night hall discussions, seniors' mentorship, and small daily habits changed everything.",
    content: `<p>When I walked through the Puri Gate of IIT Kharagpur in my first year, I felt like everyone around me already knew competitive programming and machine learning while I struggled to write a basic pointer loop in C.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">The Turning Point at 2 AM in Hall</h3>
    <p>After getting a 4/20 in my first Programming & Data Structures lab test, I almost gave up on CS research. A fourth-year senior in my wing noticed me sitting on the corridor stairs and shared something I never forgot: <em>"At KGP, nobody starts at the finish line. Pick one problem a day and stay curious."</em></p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">What Actually Worked</h3>
    <ul class="list-disc list-inside space-y-2">
      <li>Reading one research paper a week with two friends at the Central Library</li>
      <li>Contributing to open-source campus projects instead of chasing only grades</li>
      <li>Cold-emailing 40 professors with a genuine 3-sentence summary of how I reproduced their paper</li>
    </ul>
    <p class="mt-4">If you are feeling overwhelmed right now at KGP — trust your pace. Your story is just getting started.</p>`,
    author_name: "Ritwik Sen",
    author_dept: "EE '26",
    author_avatar: "from-amber-400 to-orange-600",
    read_time: "6 min",
    topic: "Read Stories",
    likes: 142,
    comments: 31
  });
  insertStory.run({
    title: "The Night Our Autonomous Rover Broke 4 Hours Before the Finale — And How Our Team Pulled Through",
    excerpt: "A personal story of grit, soldering irons at 3 AM in the Technology Students' Gymkhana workshop, and what building with fellow KGPians taught me about resilience.",
    content: `<p>Four hours before our final autonomous rover demonstration, the main motor driver board shorted out in a puff of smoke. Six months of work flashed before our eyes.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">When Everything Goes Wrong</h3>
    <p>Instead of panicking, our 8-member team split up across campus — two cycled through the rain to grab spare MOSFETs from a lab in Kalidas, three rewrote the PID controller to run on a backup microcontroller, and the rest rebuilt the wiring harness from scratch.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">The Lesson Beyond Engineering</h3>
    <p>We finished soldering 18 minutes before the judges arrived, and the rover completed the obstacle course on its first run. Years from now, I won't remember the exact code we wrote, but I will always remember the people who refused to quit at 3 AM.</p>`,
    author_name: "Nandini Bose",
    author_dept: "ME '26",
    author_avatar: "from-rose-400 to-amber-500",
    read_time: "5 min",
    topic: "Read Stories",
    likes: 98,
    comments: 19
  });
  console.log('✨ Seeded initial Read Stories articles.');
}

// Ensure all 9 AI categories (including Deep Learning, Systems, and RL) have community articles in DB
const dlCount = db.prepare(`SELECT COUNT(*) as count FROM articles WHERE topic = 'Deep Learning'`).get().count;
if (dlCount === 0) {
  const insertCategoryArticle = db.prepare(`
    INSERT INTO articles (title, excerpt, content, topic, author_name, author_dept, author_avatar, read_time, likes, comments)
    VALUES (@title, @excerpt, @content, @topic, @author_name, @author_dept, @author_avatar, @read_time, @likes, @comments)
  `);
  insertCategoryArticle.run({
    title: "FlashAttention-3 & Custom Triton Kernels: Speeding Up ViT Training on KGP's GPU Cluster",
    excerpt: "How we wrote fused Triton kernels for multi-head attention and LayerNorm to cut Vision Transformer training time by 42% on IIT Kharagpur's A100 nodes.",
    content: `<p>Memory bandwidth — not raw FLOPs — is often the real bottleneck when training deep neural networks. In this article, we break down how kernel fusion in OpenAI Triton eliminates redundant HBM reads and writes.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">Why Standard PyTorch Ops Leave Performance on the Table</h3>
    <p>Each elementwise operation in eager PyTorch launches a separate CUDA kernel and round-trips intermediate tensors through GPU High Bandwidth Memory (HBM).</p>
    <pre class="kgp-code-block"><code>import triton
import triton.language as tl

@triton.jit
def fused_rmsnorm_kernel(X, Y, W, stride, N, eps: tl.constexpr, BLOCK_SIZE: tl.constexpr):
    row = tl.program_id(0)
    cols = tl.arange(0, BLOCK_SIZE)
    mask = cols < N
    x = tl.load(X + row * stride + cols, mask=mask, other=0.0).to(tl.float32)
    rms = tl.sqrt(tl.sum(x * x, axis=0) / N + eps)
    w = tl.load(W + cols, mask=mask, other=1.0)
    tl.store(Y + row * stride + cols, (x / rms) * w, mask=mask)</code></pre>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">Benchmark Results</h3>
    <p>Across our 12-layer ViT-Base experiments at KGP, fused RMSNorm + FlashAttention reduced peak VRAM usage by 28% and improved end-to-end throughput by 1.7x.</p>`,
    author_name: "Rohan Verma",
    author_dept: "CSE '26",
    author_avatar: "from-emerald-400 to-teal-600",
    read_time: "9 min",
    topic: "Deep Learning",
    likes: 84,
    comments: 16
  });
  insertCategoryArticle.run({
    title: "Distributed LLM Serving with vLLM & PagedAttention on Multi-Node Campus Servers",
    excerpt: "Deploying a 70B parameter open-weights model across heterogeneous GPUs using tensor parallelism, continuous batching, and KV-cache quantization.",
    content: `<p>Serving large language models to ratusan of concurrent student users requires careful systems engineering. Here is how we set up high-throughput inference using vLLM.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">Solving KV-Cache Fragmentation with PagedAttention</h3>
    <p>By partitioning the KV cache into fixed-size blocks analogous to virtual memory pages in operating systems, we eliminated external fragmentation and increased batch sizes by 3.4x.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">Key Takeaways</h3>
    <ul class="list-disc list-inside space-y-2">
      <li>FP8 KV-cache quantization nearly doubles effective context capacity with negligible perplexity loss</li>
      <li>Continuous batching keeps GPU utilization above 88% under bursty campus traffic</li>
    </ul>`,
    author_name: "Arjun Mehta",
    author_dept: "CSE '25",
    author_avatar: "from-orange-400 to-amber-600",
    read_time: "10 min",
    topic: "Systems",
    likes: 73,
    comments: 14
  });
  insertCategoryArticle.run({
    title: "Proximal Policy Optimization (PPO) & GRPO from Scratch: Training Reasoning Agents",
    excerpt: "A hands-on mathematical and PyTorch walkthrough of PPO and Group Relative Policy Optimization (GRPO) for reinforcement learning on math and locomotion tasks.",
    content: `<p>Reinforcement Learning has taken center stage in post-training reasoning models. In this guide, we compare classic Actor-Critic PPO against critic-free GRPO.</p>
    <h3 class="text-xl font-bold text-white mt-8 mb-4">From PPO to GRPO</h3>
    <p>Standard PPO requires a value network (critic) of comparable size to the policy network. GRPO removes the value network entirely by normalizing rewards across a group of sampled outputs for each prompt.</p>
    <pre class="kgp-code-block"><code># Group Relative Advantage Computation
# rewards shape: (num_prompts, group_size)
mean_r = rewards.mean(dim=-1, keepdim=True)
std_r = rewards.std(dim=-1, keepdim=True) + 1e-8
advantages = (rewards - mean_r) / std_r</code></pre>
    <p>Removing the critic cuts memory consumption by nearly 40%, making RL fine-tuning accessible on single-GPU setups in KGP labs.</p>`,
    author_name: "Pranav Kulkarni",
    author_dept: "MA '26",
    author_avatar: "from-pink-400 to-rose-600",
    read_time: "8 min",
    topic: "RL",
    likes: 95,
    comments: 21
  });
  console.log('🚀 Seeded Deep Learning, Systems, and RL articles.');
}

// Seed a sample nested reply with a hyperlink if no nested replies exist yet
const nestedReplyCount = db.prepare('SELECT COUNT(*) as count FROM comments WHERE parent_id IS NOT NULL').get().count;
if (nestedReplyCount === 0) {
  const firstComment = db.prepare('SELECT id, article_id FROM comments WHERE parent_id IS NULL ORDER BY id ASC LIMIT 1').get();
  if (firstComment) {
    db.prepare(`
      INSERT INTO comments (article_id, parent_id, author_name, author_dept, author_avatar, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      firstComment.article_id,
      firstComment.id,
      'Vikram Iyer',
      "CSE '26",
      'from-violet-400 to-violet-600',
      'Yes! We tested State Space Duality from the [Mamba-2 Paper](https://arxiv.org/abs/2405.21060) and also benchmarked against https://github.com/state-spaces/mamba — throughput improved by another 1.8x!'
    );
  }
}

// Seed initial sample comments across articles and keep articles.comments synced with real comment rows
const allSeededArticles = db.prepare('SELECT id, title, author_name FROM articles ORDER BY id ASC').all();
const insertSampleComment = db.prepare(`
  INSERT INTO comments (article_id, author_name, author_dept, author_avatar, content)
  VALUES (?, ?, ?, ?, ?)
`);
for (const art of allSeededArticles) {
  const existingNonUserComments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE article_id = ? AND user_id IS NULL').get(art.id).count;
  if (existingNonUserComments === 0) {
    insertSampleComment.run(
      art.id,
      'Rohan Verma',
      "CSE '27",
      'from-cyan-400 to-cyan-600',
      `Great write-up on "${art.title.slice(0, 48)}${art.title.length > 48 ? '…' : ''}"! Really helpful for our KGP research group.`
    );
    insertSampleComment.run(
      art.id,
      'Sneha Gupta',
      "ECE '26",
      'from-rose-400 to-rose-600',
      'Super clear architecture and benchmarks. Sharing this with my labmates!'
    );
  }
}

// Sync articles.comments column with actual count of rows in comments table
db.prepare(`
  UPDATE articles
  SET comments = (SELECT COUNT(*) FROM comments WHERE comments.article_id = articles.id)
`).run();

console.log('✅ Database initialized: data/kgpconnect.sqlite');

module.exports = db;
