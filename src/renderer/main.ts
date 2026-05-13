import type {
  AchievementState,
  AchievementUnlock,
  LedgerEntry,
  LedgerFile,
  TreeAsset,
  TreeStage,
  UsageStatus,
  WindowBounds,
} from "../shared/types";
import "./styles.css";

type WeatherId = "clear" | "breeze" | "drizzle" | "rain" | "thunder" | "storm";
type ViewMode = "pet" | "manager" | "toast";
type HistoryFilter = "all" | "codex" | "openclaw" | "opencode" | "claude";
type SourceScope = "today" | "total";
type BadgeMetric = "level" | "total" | "rate";
type TotalDisplayUnit = "raw" | "k" | "m" | "wan" | "yi";
type DashboardTab = "home" | "achievements";
type AchievementCategory = "growth" | "peak" | "time" | "agent" | "hidden";
type AchievementRarity = "common" | "rare" | "epic" | "legendary" | "hidden";
type AchievementCategoryFilter = AchievementCategory;
type AchievementStatusFilter = "all" | "unlocked" | "locked" | "hidden";

interface WeatherState {
  id: WeatherId;
  label: string;
  tokensPerMinute: number;
  activity: number;
}

interface Stats {
  xp: number;
  todayXp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  stage: TreeStage;
  nextStageLabel?: string;
  stageProgress: number;
  weather: WeatherState;
  lastFiveMinuteXp: number;
  recentXp: number;
  activeSessions: number;
  sevenDays: HistoryDayRow[];
  sourceBreakdown: SourceBreakdown[];
}

interface HistoryDayRow {
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sources: Record<HistorySourceId, number>;
}

type HistorySourceId = "codex" | "openclaw" | "opencode" | "claude";

interface SourceBreakdown {
  id: string;
  label: string;
  xp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface AchievementDef {
  id: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  name: string;
  description: string;
  flavor?: string;
  hidden?: boolean;
  planned?: boolean;
  condition: (context: AchievementContext) => boolean;
  trigger?: (context: AchievementContext) => Record<string, unknown>;
}

interface AchievementContext {
  stats: Stats;
  entries: LedgerEntry[];
  stageIndex: number;
  maxDailyXp: number;
  consecutiveDays: number;
  activeSources: Set<HistorySourceId>;
  maxSourcesOneDay: number;
  hasAgentSwitchWithinTenMinutes: boolean;
  sourceXp: Record<HistorySourceId, number>;
  hourSet: Set<number>;
  weekendWarrior: boolean;
  touchGrassReturn: boolean;
  coffeeOverdose: boolean;
  hasFibonacciSession: boolean;
}

interface PureSvgManifest {
  stages: Array<{
    id: string;
    label: string;
    asset: string;
  }>;
}

interface GameBalance {
  xp: {
    levelBase: number;
    levelExponent: number;
    maxLevel: number;
  };
  weather: {
    rateWindowSeconds: number;
    thresholds: Array<{ id: WeatherId; label: string; minXpPerMinute: number }>;
  };
  activity: {
    activeWindowSeconds: number;
    peakWindowSeconds: number;
  };
  stages: Array<{ minLevel: number; id: string; label: string }>;
}

const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  growth: "成长之路",
  peak: "巅峰时刻",
  time: "时间档案",
  agent: "Agent 图鉴",
  hidden: "未解之谜",
};

const ACHIEVEMENT_RARITY_LABELS: Record<AchievementRarity, string> = {
  common: "普通",
  rare: "罕见",
  epic: "史诗",
  legendary: "传说",
  hidden: "隐藏",
};

const CATEGORY_ORDER: AchievementCategory[] = ["growth", "peak", "time", "agent", "hidden"];

function rarityOrder(rarity: AchievementRarity): number {
  const order: Record<AchievementRarity, number> = { legendary: 0, epic: 1, rare: 2, hidden: 3, common: 4 };
  return order[rarity] ?? 5;
}

const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: "sprout",
    category: "growth",
    rarity: "common",
    name: "破土而出",
    description: "小树发芽了",
    flavor: "每一棵大树，都曾是一粒种子。",
    condition: ({ stats }) => stats.xp >= 1_000,
  },
  {
    id: "sapling",
    category: "growth",
    rarity: "rare",
    name: "亭亭玉立",
    description: "长出像样的树冠",
    flavor: "你的树已经不再是路边的杂草了。",
    condition: ({ stageIndex }) => stageIndex >= 2,
  },
  {
    id: "big_tree",
    category: "growth",
    rarity: "legendary",
    name: "枝繁叶茂",
    description: "已经是一棵大树了",
    flavor: "鸟儿们开始考虑在你这里安家。",
    condition: ({ stageIndex }) => stageIndex >= 5,
  },
  {
    id: "xp_10k",
    category: "growth",
    rarity: "common",
    name: "万字打工人",
    description: "累计 10,000 XP",
    flavor: "一万个 token，都是汗水的结晶。",
    condition: ({ stats }) => stats.xp >= 10_000,
  },
  {
    id: "xp_100k",
    category: "growth",
    rarity: "rare",
    name: "十万军中取上将",
    description: "累计 100,000 XP",
    flavor: "十万大军中，你就是最亮的星。",
    condition: ({ stats }) => stats.xp >= 100_000,
  },
  {
    id: "xp_1m",
    category: "growth",
    rarity: "epic",
    name: "百万字灵魂",
    description: "累计 1,000,000 XP",
    flavor: "如果每个 token 是一步，你已经走了很远。",
    condition: ({ stats }) => stats.xp >= 1_000_000,
  },
  {
    id: "xp_10m",
    category: "growth",
    rarity: "epic",
    name: "千万字成精",
    description: "累计 10,000,000 XP",
    flavor: "传说修炼千万年可以成精，你用 token 做到了。",
    condition: ({ stats }) => stats.xp >= 10_000_000,
  },
  {
    id: "xp_100m",
    category: "growth",
    rarity: "legendary",
    name: "亿点点努力",
    description: "累计 100,000,000 XP",
    flavor: "亿点点？这明明是亿吨吨努力。",
    condition: ({ stats }) => stats.xp >= 100_000_000,
  },
  {
    id: "xp_1b",
    category: "growth",
    rarity: "legendary",
    name: "十亿树王",
    description: "累计 1,000,000,000 XP",
    flavor: "整片森林都得叫你一声大哥。",
    condition: ({ stats }) => stats.xp >= 1_000_000_000,
  },
  {
    id: "reborn",
    category: "growth",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "涅槃",
    description: "重置后再次满级",
    flavor: "浴火重生，更胜从前。",
    condition: () => false,
  },
  {
    id: "daily_1k",
    category: "peak",
    rarity: "common",
    name: "热身完毕",
    description: "单日 XP 达到 1,000",
    flavor: "热身而已，真正的锻炼还没开始。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 1_000,
  },
  {
    id: "daily_10k",
    category: "peak",
    rarity: "common",
    name: "今天真拼了",
    description: "单日 XP 达到 10,000",
    flavor: "今天的你，值得一杯奶茶。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 10_000,
  },
  {
    id: "daily_50k",
    category: "peak",
    rarity: "rare",
    name: "疯狂星期四",
    description: "单日 XP 达到 50,000",
    flavor: "V 我 50k XP，谢谢。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 50_000,
  },
  {
    id: "daily_1m",
    category: "peak",
    rarity: "epic",
    name: "今日爆肝",
    description: "单日 XP 达到 1,000,000",
    flavor: "你的肝发来了求救信号。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 1_000_000,
  },
  {
    id: "daily_10m",
    category: "peak",
    rarity: "epic",
    name: "服务器发烫",
    description: "单日 XP 达到 10,000,000",
    flavor: "机房管理员已经拿起了灭火器。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 10_000_000,
  },
  {
    id: "daily_100m",
    category: "peak",
    rarity: "legendary",
    name: "天气系统失控",
    description: "单日 XP 达到 100,000,000",
    flavor: "气象局表示无法预测此次风暴。",
    condition: ({ maxDailyXp }) => maxDailyXp >= 100_000_000,
  },
  {
    id: "streak_3",
    category: "growth",
    rarity: "common",
    name: "三天打鱼",
    description: "连续 3 天有 XP",
    flavor: "坚持三天已经超过了很多新年计划。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 3,
  },
  {
    id: "streak_7",
    category: "growth",
    rarity: "rare",
    name: "不打鱼了",
    description: "连续 7 天有 XP",
    flavor: "两天晒网的日子一去不复返了。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 7,
  },
  {
    id: "streak_30",
    category: "growth",
    rarity: "legendary",
    name: "月租户",
    description: "连续 30 天有 XP",
    flavor: "房东表示你可以考虑签长期合同了。",
    condition: ({ consecutiveDays }) => consecutiveDays >= 30,
  },
  {
    id: "burst_60",
    category: "peak",
    rarity: "common",
    name: "灵感爆发",
    description: "XP/min 达到 60",
    flavor: "灵感来了挡都挡不住。",
    condition: ({ stats }) => stats.weather.tokensPerMinute >= 60,
  },
  {
    id: "burst_10k",
    category: "peak",
    rarity: "rare",
    name: "手速起飞",
    description: "XP/min 达到 10,000",
    flavor: "你的键盘正在请求加薪。",
    condition: ({ stats }) => stats.weather.tokensPerMinute >= 10_000,
  },
  {
    id: "burst_100k",
    category: "peak",
    rarity: "epic",
    name: "雨云生成器",
    description: "XP/min 达到 100,000",
    flavor: "云层越来越厚，暴风雨即将来临。",
    condition: ({ stats }) => stats.weather.tokensPerMinute >= 100_000,
  },
  {
    id: "burst_1m",
    category: "peak",
    rarity: "legendary",
    name: "风暴召唤师",
    description: "XP/min 达到 1,000,000",
    flavor: "这不是 coding，这是召唤天气奇观。",
    condition: ({ stats }) => stats.weather.tokensPerMinute >= 1_000_000,
  },
  {
    id: "long_session",
    category: "growth",
    rarity: "epic",
    planned: true,
    name: "坐忘",
    description: "单 session 持续超过 4 小时",
    flavor: "你和椅子达成了高度同步。",
    condition: () => false,
  },
  {
    id: "midnight",
    category: "time",
    rarity: "common",
    name: "午夜写诗",
    description: "凌晨 0 点以后还在用",
    flavor: "夜色正好，代码也正好。",
    condition: ({ hourSet }) => hourSet.has(0),
  },
  {
    id: "deep_night",
    category: "time",
    rarity: "rare",
    name: "夜猫本猫",
    description: "凌晨 3 点还在 coding",
    flavor: "凌晨三点的代码，有种别样的浪漫。",
    condition: ({ hourSet }) => hourSet.has(3),
  },
  {
    id: "sunrise",
    category: "time",
    rarity: "rare",
    name: "看过日出",
    description: "凌晨 5 点还在 coding",
    flavor: "是通宵到天亮，不是早起看日出对吧？",
    condition: ({ hourSet }) => hourSet.has(5),
  },
  {
    id: "early_bird",
    category: "time",
    rarity: "common",
    name: "早起的鸟",
    description: "早上 6 点到 7 点有 XP",
    flavor: "早起的鸟儿有虫吃，早起的 coder 有 bug 修。",
    condition: ({ hourSet }) => hourSet.has(6),
  },
  {
    id: "all_nighter",
    category: "time",
    rarity: "epic",
    planned: true,
    name: "昼夜不分",
    description: "同一 session 跨越午夜",
    flavor: "对你来说，时间不过是屏幕右下角的数字。",
    condition: () => false,
  },
  {
    id: "weekend_warrior",
    category: "time",
    rarity: "rare",
    name: "周末不休",
    description: "周六周日各有 XP",
    flavor: "休息日只是换一种方式继续努力。",
    condition: ({ weekendWarrior }) => weekendWarrior,
  },
  {
    id: "codex_connected",
    category: "agent",
    rarity: "common",
    name: "Codex 接入",
    description: "Codex 有第一条事件",
    flavor: "欢迎 Codex 加入豪华午餐。",
    condition: ({ activeSources }) => activeSources.has("codex"),
  },
  {
    id: "claude_connected",
    category: "agent",
    rarity: "common",
    name: "Claude 接入",
    description: "Claude Code 有第一条事件",
    flavor: "Claude 已就位，请下达指令。",
    condition: ({ activeSources }) => activeSources.has("claude"),
  },
  {
    id: "openclaw_connected",
    category: "agent",
    rarity: "common",
    name: "Kiki 接入",
    description: "OpenClaw 有第一条事件",
    flavor: "Kiki 说这棵树可以养。",
    condition: ({ activeSources }) => activeSources.has("openclaw"),
  },
  {
    id: "opencode_connected",
    category: "agent",
    rarity: "rare",
    name: "四合一",
    description: "OpenCode 也接上了",
    flavor: "集齐四个 agent 可以召唤神龙。",
    condition: ({ activeSources }) => activeSources.has("opencode"),
  },
  {
    id: "all_agents",
    category: "agent",
    rarity: "legendary",
    name: "全家桶",
    description: "四种 agent 全部接入",
    flavor: "恭喜获得全家桶套餐，附赠加大可乐。",
    condition: ({ activeSources }) => activeSources.size >= 4,
  },
  {
    id: "multi_agent_day",
    category: "agent",
    rarity: "epic",
    name: "多线作战",
    description: "同一天用了 3 种 agent",
    flavor: "一个脑袋不够用，那就多开几条线。",
    condition: ({ maxSourcesOneDay }) => maxSourcesOneDay >= 3,
  },
  {
    id: "agent_switcher",
    category: "agent",
    rarity: "rare",
    name: "不忠诚",
    description: "10 分钟内切换了 agent",
    flavor: "花心不是你的错，是 agent 太多了。",
    condition: ({ hasAgentSwitchWithinTenMinutes }) => hasAgentSwitchWithinTenMinutes,
  },
  {
    id: "touch_grass",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "去外面走走",
    description: "超过 7 天没有 XP 后再次回来",
    flavor: "小树以为你真的去晒太阳了。",
    condition: ({ touchGrassReturn }) => touchGrassReturn,
  },
  {
    id: "coffee_overdose",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "咖啡因超载",
    description: "连续 8 小时不间断 XP 入账",
    flavor: "此成就不建议配合第三杯咖啡食用。",
    condition: ({ coffeeOverdose }) => coffeeOverdose,
  },
  {
    id: "xp_zero_day",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "摸鱼冠军",
    description: "某天 XP 为 0 但 app 开着",
    flavor: "今天的你选择了世界和平。",
    condition: () => false,
  },
  {
    id: "delete_regret",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "删了又装",
    description: "重新安装后读到历史数据",
    flavor: "我就知道你会回来的。",
    condition: () => false,
  },
  {
    id: "kiki_approved",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "获得 Kiki 认证",
    description: "OpenClaw 贡献达到 500,000 XP",
    flavor: "Kiki 点了点头，事情开始变得正式。",
    condition: ({ sourceXp }) => sourceXp.openclaw >= 500_000,
  },
  {
    id: "tree_whisperer",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    planned: true,
    name: "树语者",
    description: "盯着小树超过 10 分钟没有动",
    flavor: "你们之间产生了一种安静的理解。",
    condition: () => false,
  },
  {
    id: "fibonacci",
    category: "hidden",
    rarity: "hidden",
    hidden: true,
    name: "数学家精神",
    description: "某次 session XP 恰好是斐波那契数",
    flavor: "1, 1, 2, 3, 5, 8, 13... 宇宙的密码藏在 session 里。",
    condition: ({ hasFibonacciSession }) => hasFibonacciSession,
  },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
document.title = "Vibe Tree";

const viewParam = new URLSearchParams(location.search).get("view");
const viewMode: ViewMode = viewParam === "manager" ? "manager" : viewParam === "toast" ? "toast" : "pet";
let ledger: LedgerFile | null = null;
let tree: TreeAsset | null = null;
let gameBalance: GameBalance | null = null;
let usageStatus: UsageStatus | null = null;
let achievementState: AchievementState = { unlocked: [] };
let lastWeatherId: WeatherId | null = null;
let lastRenderedLevel: number | null = null;
let levelUpTimer: number | undefined;
let achievementSyncInFlight = false;
let achievementToastTimer: number | undefined;
let lockedAchievementHintTimer: number | undefined;
const achievementToastQueue: AchievementDef[] = [];
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const TOAST_PREVIEW_IDS = ["sprout", "deep_night", "xp_1m", "xp_100m", "fibonacci"];
let toastPreviewIndex = 0;
let pendingLevelUp: { from: number; to: number } | null = null;
const AUTO_BADGE_FLIP_MS = 30_000;
const BADGE_TOKEN_HOLD_MS = 2_500;
const badgeFlipTimers = new Map<string, number>();
let badgeAutoFlipTimer: number | undefined;
let historyFilter: HistoryFilter = "all";
let lastHistoryChartKey = "";
let sourceScope: SourceScope = "today";
let dashboardTab: DashboardTab = "home";
let achievementCategoryFilter: AchievementCategoryFilter = "growth";
let achievementStatusFilter: AchievementStatusFilter = "all";
let seenAchievementIds = new Set<string>();
let expandedSourceKey: string | null = null;
let dragState: null | {
  startMouse: { x: number; y: number };
  startBounds: WindowBounds;
} = null;

if (viewMode === "pet") {
  app.innerHTML = `
    <main class="pet-root" data-locked="false" data-weather="clear" data-active="false">
      <section class="pet-stage" id="petStage" aria-label="Vibe Tree">
        <div class="weather-layer weather-back" id="weatherBack"></div>
        <div class="pet-aura"></div>
        <img class="tree-image" id="treeImage" alt="Vibe Tree" draggable="false" />
        <div class="weather-layer weather-front" id="weatherFront"></div>
        <div class="level-up-toast" aria-hidden="true">
          <strong>LEVEL UP!</strong>
          <span id="petLevelUpText">Lv.1 -> Lv.2</span>
        </div>
        <div class="level-badge" id="petLevelBadge">
          <span class="badge-card">
            <span class="badge-face badge-front">Lv.1</span>
            <span class="badge-face badge-back">0</span>
          </span>
        </div>
        <button class="pet-hitbox" id="petHitbox" type="button" aria-label="打开 Vibe Tree"></button>
      </section>
    </main>
  `;
} else if (viewMode === "manager") {
  app.innerHTML = `
    <main class="manager-root" data-weather="clear" data-active="false">
      <aside class="pet-preview-panel">
        <header class="app-title">
          <p>Vibe Tree</p>
          <h1>Token 天气树</h1>
        </header>

        <section class="preview-stage" aria-label="桌面小树预览">
          <div class="weather-layer weather-back" id="previewWeatherBack"></div>
          <div class="pet-aura"></div>
          <img class="tree-image" id="previewTreeImage" alt="Vibe Tree preview" draggable="false" />
          <div class="weather-layer weather-front" id="previewWeatherFront"></div>
          <div class="level-up-toast" aria-hidden="true">
            <strong>LEVEL UP!</strong>
            <span id="previewLevelUpText">Lv.1 -> Lv.2</span>
          </div>
          <div class="level-badge preview-level" id="previewLevelBadge">
            <span class="badge-card">
              <span class="badge-face badge-front">Lv.1</span>
              <span class="badge-face badge-back">0</span>
            </span>
          </div>
        </section>

        <nav class="side-tabs" id="sideTabs" aria-label="页面切换">
          <button type="button" data-dashboard-tab="home">主页</button>
          <button type="button" data-dashboard-tab="achievements">成就</button>
        </nav>

      </aside>
      <button class="settings-fab" id="settingsButton" type="button" aria-label="打开设置" title="设置">⚙</button>

      <section class="dashboard">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow">Live growth</p>
            <h2 id="levelTitle">Lv.1 新芽</h2>
          </div>
          <div class="weather-readout">
            <span id="weatherLabel">晴朗</span>
            <strong id="weatherRateText">0 XP/min</strong>
          </div>
        </header>

        <div class="metric-grid">
          <article>
            <span>累计 XP</span>
            <strong id="totalText">0</strong>
          </article>
          <article>
            <span>今日成长</span>
            <strong id="todayText">0</strong>
          </article>
          <article>
            <span>活跃会话</span>
            <strong id="activeSessionsText">0</strong>
          </article>
        </div>

        <section class="progress-block">
          <div class="progress-meta">
            <span id="nextLevelText">距离 Lv.2</span>
            <span id="progressText">0 / 800 XP</span>
          </div>
          <div class="progress-track xp-track">
            <span id="progressBar"></span>
          </div>
        </section>

        <section class="achievement-card" aria-label="Achievements">
          <div class="section-header">
            <div>
              <h3>纪念 / 成就</h3>
            </div>
            <div class="achievement-header-tools">
              <button class="achievement-preview-button" id="achievementToastPreviewButton" type="button">预览弹窗</button>
              <span id="achievementSummary">0 / 0</span>
            </div>
          </div>
          <div class="achievement-overview" id="achievementOverview"></div>
          <div class="achievement-filter-panel">
            <div class="achievement-category-tabs" id="achievementCategoryTabs" role="tablist" aria-label="成就分类">
              <button type="button" data-achievement-category="growth">成长之路</button>
              <button type="button" data-achievement-category="peak">巅峰时刻</button>
              <button type="button" data-achievement-category="time">时间档案</button>
              <button type="button" data-achievement-category="agent">Agent</button>
              <button type="button" data-achievement-category="hidden">未解之谜</button>
            </div>
            <div class="achievement-status-tabs" id="achievementStatusTabs" role="tablist" aria-label="成就状态">
              <button type="button" data-achievement-status="all">全部</button>
              <button type="button" data-achievement-status="unlocked">已点亮</button>
              <button type="button" data-achievement-status="locked">未点亮</button>
            </div>
          </div>
          <div class="achievement-recent" id="achievementRecent"></div>
          <div class="achievement-grid" id="achievementGrid"></div>
        </section>

        <section class="source-card" aria-label="Token 来源">
          <div class="section-header">
            <h3>数据来源</h3>
            <div class="source-header-tools">
              <div class="source-scope-tabs" id="sourceScopeTabs" role="tablist" aria-label="数据来源范围">
                <button type="button" data-source-scope="today">今日</button>
                <button type="button" data-source-scope="total">总计</button>
              </div>
            </div>
          </div>
          <div class="source-rows" id="sourceBreakdown"></div>
        </section>

        <section class="chart-card">
          <div class="section-header">
            <h3>最近 7 天</h3>
            <span id="peakText">5 分钟 +0 XP</span>
          </div>
        </section>
      </section>
      <div class="achievement-toast-layer" id="achievementToastLayer" aria-live="polite"></div>

      <section class="settings-modal" id="settingsModal" aria-hidden="true">
        <div class="settings-backdrop" id="settingsBackdrop"></div>
        <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
          <header class="settings-panel-header">
            <div>
              <p class="eyebrow">偏好设置</p>
              <h3 id="settingsTitle">设置</h3>
            </div>
            <button class="icon-button" id="settingsCloseButton" type="button" aria-label="关闭设置">×</button>
          </header>

          <section class="settings-section">
            <h4>桌面小树</h4>
            <div class="pet-settings" aria-label="桌面小树设置">
              <label class="scale-select">
                大小
                <select id="scaleSelect">
                  <option value="0.5">0.5x</option>
                  <option value="1">1x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
              </label>
              <label class="toggle-row">
                <input id="lockInput" type="checkbox" />
                <span>锁定小树位置</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>牌子显示</h4>
            <div class="badge-settings" aria-label="牌子显示">
              <label>
                正面
                <select id="badgeFrontMetricSelect">
                  <option value="level">等级</option>
                  <option value="total">累计 token</option>
                  <option value="rate">token/s</option>
                </select>
              </label>
              <label>
                背面
                <select id="badgeBackMetricSelect">
                  <option value="level">等级</option>
                  <option value="total">累计 token</option>
                  <option value="rate">token/s</option>
                </select>
              </label>
              <label>
                总量单位
                <select id="totalDisplayUnitSelect">
                  <option value="raw">完整数字</option>
                  <option value="k">k</option>
                  <option value="m">m</option>
                  <option value="wan">万</option>
                  <option value="yi">亿</option>
                </select>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>设备</h4>
            <div class="device-controls" aria-label="设备设置">
              <label class="toggle-row">
                <input id="launchOnStartupInput" type="checkbox" />
                <span>开机启动</span>
              </label>
              <label class="toggle-row">
                <input id="silentStartupInput" type="checkbox" />
                <span>静默启动</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>Agent 路径</h4>
            <div class="path-settings">
              <label>
                Codex 路径
                <input id="codexSessionsDirInput" type="text" placeholder="~/.codex/sessions" />
              </label>
              <label>
                Claude 路径
                <input id="claudeSessionsDirInput" type="text" placeholder="~/.claude/projects" />
              </label>
              <label>
                OpenClaw 路径
                <input id="openclawSessionsDirInput" type="text" placeholder="~/.openclaw/agents" />
              </label>
              <label>
                OpenCode 路径
                <input id="opencodeSessionsDirInput" type="text" placeholder="~/.local/share/opencode/storage/message" />
              </label>
            </div>
          </section>
        </div>
      </section>
    </main>
  `;
} else {
  app.innerHTML = `
    <main class="toast-root" data-placement="right">
      <div class="achievement-toast-layer" id="achievementToastLayer" aria-live="polite"></div>
    </main>
  `;
}

const root = document.querySelector<HTMLElement>(
  viewMode === "pet" ? ".pet-root" : viewMode === "manager" ? ".manager-root" : ".toast-root",
)!;
const treeImage = document.querySelector<HTMLImageElement>("#treeImage");
const previewTreeImage = document.querySelector<HTMLImageElement>("#previewTreeImage");
const weatherBack = document.querySelector<HTMLElement>("#weatherBack");
const weatherFront = document.querySelector<HTMLElement>("#weatherFront");
const previewWeatherBack = document.querySelector<HTMLElement>("#previewWeatherBack");
const previewWeatherFront = document.querySelector<HTMLElement>("#previewWeatherFront");
const petLevelBadge = document.querySelector<HTMLElement>("#petLevelBadge");
const previewLevelBadge = document.querySelector<HTMLElement>("#previewLevelBadge");
const lockInput = document.querySelector<HTMLInputElement>("#lockInput");
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton");
const settingsCloseButton = document.querySelector<HTMLButtonElement>("#settingsCloseButton");
const settingsBackdrop = document.querySelector<HTMLElement>("#settingsBackdrop");
const settingsModal = document.querySelector<HTMLElement>("#settingsModal");
const scaleSelect = document.querySelector<HTMLSelectElement>("#scaleSelect");
const launchOnStartupInput = document.querySelector<HTMLInputElement>("#launchOnStartupInput");
const silentStartupInput = document.querySelector<HTMLInputElement>("#silentStartupInput");
const badgeFrontMetricSelect = document.querySelector<HTMLSelectElement>("#badgeFrontMetricSelect");
const badgeBackMetricSelect = document.querySelector<HTMLSelectElement>("#badgeBackMetricSelect");
const totalDisplayUnitSelect = document.querySelector<HTMLSelectElement>("#totalDisplayUnitSelect");
const codexSessionsDirInput = document.querySelector<HTMLInputElement>("#codexSessionsDirInput");
const claudeSessionsDirInput = document.querySelector<HTMLInputElement>("#claudeSessionsDirInput");
const openclawSessionsDirInput = document.querySelector<HTMLInputElement>("#openclawSessionsDirInput");
const opencodeSessionsDirInput = document.querySelector<HTMLInputElement>("#opencodeSessionsDirInput");

if (viewMode === "manager") {
  setupHistoryCard();
}

const historyBars = document.querySelector<HTMLElement>("#historyBars");
const historyTabs = document.querySelector<HTMLElement>("#historyTabs");
const historyLegend = document.querySelector<HTMLElement>("#historyLegend");
const sourceScopeTabs = document.querySelector<HTMLElement>("#sourceScopeTabs");
const sourceBreakdownElement = document.querySelector<HTMLElement>("#sourceBreakdown");
const sideTabs = document.querySelector<HTMLElement>("#sideTabs");
const achievementSummaryElement = document.querySelector<HTMLElement>("#achievementSummary");
const achievementOverviewElement = document.querySelector<HTMLElement>("#achievementOverview");
const achievementRecentElement = document.querySelector<HTMLElement>("#achievementRecent");
const achievementGridElement = document.querySelector<HTMLElement>("#achievementGrid");
const achievementCategoryTabs = document.querySelector<HTMLElement>("#achievementCategoryTabs");
const achievementStatusTabs = document.querySelector<HTMLElement>("#achievementStatusTabs");
const achievementToastPreviewButton = document.querySelector<HTMLButtonElement>("#achievementToastPreviewButton");
const achievementToastLayer = document.querySelector<HTMLElement>("#achievementToastLayer");

function setupHistoryCard() {
  const card = document.querySelector<HTMLElement>(".chart-card");
  if (!card) return;
  card.innerHTML = `
    <div class="chart-top">
      <div>
        <h3>最近 7 天</h3>
        <span id="historySummary">全部来源</span>
      </div>
      <div class="history-tabs" id="historyTabs" role="tablist" aria-label="最近 7 天来源">
        <button type="button" data-history-filter="all">全部</button>
        <button type="button" data-history-filter="codex">Codex</button>
        <button type="button" data-history-filter="openclaw">OpenClaw</button>
        <button type="button" data-history-filter="opencode">OpenCode</button>
        <button type="button" data-history-filter="claude">Claude Code</button>
      </div>
    </div>
    <div class="history-legend" id="historyLegend" aria-label="token 类型">
      <span><i class="legend-input"></i>input</span>
      <span><i class="legend-output"></i>output</span>
      <span><i class="legend-cache-read"></i>cache hit</span>
      <span><i class="legend-cache-write"></i>cache write</span>
    </div>
    <div class="history-bars" id="historyBars" aria-label="最近 7 天 XP"></div>
  `;
}

async function boot() {
  if (viewMode === "toast") {
    bindToastOverlayEvents();
    return;
  }

  const [manifest, balance] = await Promise.all([
    fetch(assetUrl("/assets/trees/vibe-bonsai/config/pure-svg-manifest.json")).then(
      (res) => res.json() as Promise<PureSvgManifest>,
    ),
    fetch(assetUrl("/assets/trees/vibe-bonsai/config/game-balance.json")).then(
      (res) => res.json() as Promise<GameBalance>,
    ),
  ]);
  tree = buildTreeAsset(manifest);
  gameBalance = balance;
  ledger = await window.bonsai.getLedger();
  usageStatus = await window.bonsai.getUsageStatus();
  achievementState = await window.bonsai.getAchievements();
  initializeSeenAchievements();

  bindEvents();
  render();
  setInterval(render, 1_000);
  startAutoBadgeFlipLoop();

  window.bonsai.onLedger((nextLedger) => {
    ledger = nextLedger;
    render();
  });
  window.bonsai.onUsageStatus((nextStatus) => {
    usageStatus = nextStatus;
    renderUsageStatus();
  });
  window.bonsai.onAchievements((nextState, unlocked) => {
    achievementState = nextState;
    renderAchievements();
  });
}

function bindToastOverlayEvents() {
  window.bonsai.onAchievementToast((payload) => {
    root.dataset.placement = payload.placement;
    queueAchievementToasts(payload.ids);
  });
  window.bonsai.onAchievementToastPlacement((placement) => {
    root.dataset.placement = placement;
  });
  window.bonsai.notifyAchievementToastReady();
}

function bindEvents() {
  if (viewMode === "pet") {
    const petStage = document.querySelector<HTMLElement>("#petStage")!;
    const petHitbox = document.querySelector<HTMLButtonElement>("#petHitbox")!;
    petLevelBadge?.addEventListener("pointerenter", () => {
      showLevelBadgeBack("#petLevelBadge");
    });
    petLevelBadge?.addEventListener("pointerleave", () => {
      hideLevelBadgeBack("#petLevelBadge");
    });
    petLevelBadge?.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petHitbox.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petStage.addEventListener("mousedown", async (event) => {
      if (event.button !== 0 || ledger?.settings.locked) return;
      const startBounds = await window.bonsai.getWindowBounds();
      if (!startBounds) return;
      dragState = {
        startMouse: { x: event.screenX, y: event.screenY },
        startBounds,
      };
    });

    window.addEventListener("mousemove", async (event) => {
      if (!dragState) return;
      const dx = event.screenX - dragState.startMouse.x;
      const dy = event.screenY - dragState.startMouse.y;
      await window.bonsai.setWindowPosition({
        x: dragState.startBounds.x + dx,
        y: dragState.startBounds.y + dy,
      });
    });

    window.addEventListener("mouseup", async () => {
      if (!dragState) return;
      dragState = null;
      await window.bonsai.persistWindowPosition();
    });
  } else {
    previewLevelBadge?.addEventListener("pointerenter", () => {
      showLevelBadgeBack("#previewLevelBadge");
    });
    previewLevelBadge?.addEventListener("pointerleave", () => {
      hideLevelBadgeBack("#previewLevelBadge");
    });
  }

  lockInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ locked: lockInput.checked });
    render();
  });

  settingsButton?.addEventListener("click", () => {
    setSettingsOpen(true);
  });

  settingsCloseButton?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  settingsBackdrop?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSettingsOpen(false);
  });

  scaleSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ scale: Number(scaleSelect.value) });
    render();
  });

  launchOnStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ launchOnStartup: launchOnStartupInput.checked });
    render();
  });

  silentStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ silentStartup: silentStartupInput.checked });
    render();
  });

  badgeFrontMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeFrontMetric: normalizeBadgeMetric(badgeFrontMetricSelect.value, "level"),
    });
    render();
  });

  badgeBackMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeBackMetric: normalizeBadgeMetric(badgeBackMetricSelect.value, "total"),
    });
    render();
  });

  totalDisplayUnitSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      totalDisplayUnit: normalizeTotalDisplayUnit(totalDisplayUnitSelect.value),
    });
    render();
  });

  codexSessionsDirInput?.addEventListener("change", () => updatePathSetting("codexSessionsDir", codexSessionsDirInput));
  claudeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("claudeSessionsDir", claudeSessionsDirInput),
  );
  openclawSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("openclawSessionsDir", openclawSessionsDirInput),
  );
  opencodeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("opencodeSessionsDir", opencodeSessionsDirInput),
  );

  historyTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-history-filter]");
    if (!button) return;
    const nextFilter = button.dataset.historyFilter as HistoryFilter | undefined;
    if (!nextFilter || nextFilter === historyFilter) return;
    historyFilter = nextFilter;
    render();
  });

  sourceBreakdownElement?.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-source-key]");
    if (!row || !ledger) return;
    const sourceKey = row.dataset.sourceKey;
    if (!sourceKey) return;
    expandedSourceKey = expandedSourceKey === sourceKey ? null : sourceKey;
    renderScopedSourceBreakdown();
  });

  sourceScopeTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-source-scope]");
    if (!button) return;
    const nextScope = button.dataset.sourceScope as SourceScope | undefined;
    if (!nextScope || nextScope === sourceScope) return;
    sourceScope = nextScope;
    expandedSourceKey = null;
    renderScopedSourceBreakdown();
  });

  sideTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dashboard-tab]");
    if (!button) return;
    const nextTab = button.dataset.dashboardTab as DashboardTab | undefined;
    if (!nextTab || nextTab === dashboardTab) return;
    dashboardTab = nextTab;
    renderDashboardTabs();
  });

  achievementCategoryTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-achievement-category]");
    if (!button) return;
    const nextCategory = button.dataset.achievementCategory as AchievementCategoryFilter | undefined;
    if (!nextCategory || nextCategory === achievementCategoryFilter) return;
    achievementCategoryFilter = nextCategory;
    renderAchievements();
  });

  achievementStatusTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-achievement-status]");
    if (!button) return;
    const nextStatus = button.dataset.achievementStatus as AchievementStatusFilter | undefined;
    if (!nextStatus || nextStatus === achievementStatusFilter) return;
    achievementStatusFilter = nextStatus;
    renderAchievements();
  });

  achievementGridElement?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-achievement-id]");
    if (!item) return;
    const id = item.dataset.achievementId;
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return;
    if (!achievementUnlockedIds().has(def.id)) {
      showLockedAchievementHint(item);
      return;
    }
    markAchievementSeen(def.id);
    showAchievementDetail(def);
  });

  achievementRecentElement?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>("[data-achievement-id]");
    if (!item) return;
    const id = item.dataset.achievementId;
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return;
    markAchievementSeen(def.id);
    showAchievementDetail(def);
  });

  achievementToastPreviewButton?.addEventListener("click", () => {
    previewAchievementToast();
  });

}

async function updatePathSetting(
  key: "codexSessionsDir" | "claudeSessionsDir" | "openclawSessionsDir" | "opencodeSessionsDir",
  input: HTMLInputElement,
) {
  if (!ledger) return;
  const value = input.value.trim() || undefined;
  ledger = await window.bonsai.updateSettings({ [key]: value });
  render();
}

function setSettingsOpen(open: boolean) {
  if (!settingsModal) return;
  settingsModal.classList.toggle("open", open);
  settingsModal.setAttribute("aria-hidden", String(!open));
}

function render() {
  if (!ledger || !tree || !gameBalance) return;
  const stats = calculateStats(ledger.entries, tree, gameBalance);
  const leveledUp = lastRenderedLevel !== null && stats.level > lastRenderedLevel;
  if (leveledUp && lastRenderedLevel !== null) {
    pendingLevelUp = { from: lastRenderedLevel, to: stats.level };
  }
  lastRenderedLevel = stats.level;

  root.dataset.weather = stats.weather.id;
  root.dataset.locked = String(ledger.settings.locked);
  root.dataset.active = String(stats.recentXp > 0 || stats.weather.tokensPerMinute > 0);
  root.dataset.scale = String(ledger.settings.scale).replace(".", "-");
  root.dataset.stage = stats.stage.id;
  root.dataset.tab = dashboardTab;

  if (treeImage) {
    treeImage.src = assetUrl(stats.stage.image);
    treeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }
  if (previewTreeImage) {
    previewTreeImage.src = assetUrl(stats.stage.image);
    previewTreeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }

  renderLevelBadge(
    "#petLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  renderLevelBadge(
    "#previewLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  text("#levelTitle", `Lv.${stats.level} ${stats.stage.label}`);
  text("#weatherLabel", stats.weather.label);
  text("#weatherRateText", `${formatNumber(stats.weather.tokensPerMinute)} XP/min`);
  text("#totalText", formatNumber(stats.xp));
  text("#todayText", `+${formatNumber(stats.todayXp)}`);
  text("#activeSessionsText", stats.activeSessions ? `${stats.activeSessions} 个` : "0");
  text("#peakText", `5 分钟 +${formatNumber(stats.lastFiveMinuteXp)} XP`);
  text("#nextLevelText", `距离 Lv.${stats.level + 1}`);
  text("#progressText", `${formatNumber(stats.levelXp)} / ${formatNumber(stats.nextLevelXp)} XP`);
  renderScopedSourceBreakdown();

  const progressBar = document.querySelector<HTMLElement>("#progressBar");
  if (progressBar) progressBar.style.width = `${stats.levelProgress * 100}%`;
  if (lockInput) lockInput.checked = ledger.settings.locked;
  if (scaleSelect) scaleSelect.value = String(ledger.settings.scale);
  if (launchOnStartupInput) launchOnStartupInput.checked = ledger.settings.launchOnStartup;
  if (silentStartupInput) silentStartupInput.checked = ledger.settings.silentStartup;
  if (badgeFrontMetricSelect) badgeFrontMetricSelect.value = ledger.settings.badgeFrontMetric;
  if (badgeBackMetricSelect) badgeBackMetricSelect.value = ledger.settings.badgeBackMetric;
  if (totalDisplayUnitSelect) totalDisplayUnitSelect.value = ledger.settings.totalDisplayUnit;
  syncInputValue(codexSessionsDirInput, ledger.settings.codexSessionsDir ?? "");
  syncInputValue(claudeSessionsDirInput, ledger.settings.claudeSessionsDir ?? "");
  syncInputValue(openclawSessionsDirInput, ledger.settings.openclawSessionsDir ?? "");
  syncInputValue(opencodeSessionsDirInput, ledger.settings.opencodeSessionsDir ?? "");

  if (lastWeatherId !== stats.weather.id) {
    lastWeatherId = stats.weather.id;
    renderWeatherLayers(stats.weather.id);
  }
  if (pendingLevelUp) triggerLevelUpAnimation(pendingLevelUp);
  renderUsageStatus();
  renderHistoryChart(getSevenDayRows(ledger.entries, historyFilter), historyFilter);
  const achievementContext = buildAchievementContext(stats);
  renderAchievements(stats, achievementContext);
  renderDashboardTabs();
  syncAchievements(stats, achievementContext);
}

function renderDashboardTabs() {
  root.dataset.tab = dashboardTab;
  sideTabs?.querySelectorAll<HTMLButtonElement>("[data-dashboard-tab]").forEach((button) => {
    const active = button.dataset.dashboardTab === dashboardTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function triggerLevelUpAnimation(levels: { from: number; to: number }) {
  text("#petLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
  text("#previewLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
  pendingLevelUp = null;
  root.classList.remove("level-up");
  void root.offsetWidth;
  root.classList.add("level-up");
  if (levelUpTimer) window.clearTimeout(levelUpTimer);
  levelUpTimer = window.setTimeout(() => {
    root.classList.remove("level-up");
    levelUpTimer = undefined;
  }, 2200);
}

function renderAchievements(stats?: Stats, context?: AchievementContext) {
  if (!achievementSummaryElement || !achievementGridElement) return;
  if (!stats && ledger && tree && gameBalance) stats = calculateStats(ledger.entries, tree, gameBalance);
  if (!context && stats) context = buildAchievementContext(stats);
  const unlockedIds = achievementUnlockedIds();
  const unseenIds = new Set([...unlockedIds].filter((id) => !seenAchievementIds.has(id)));
  const visibleDefs = ACHIEVEMENTS.filter((def) => !def.planned || unlockedIds.has(def.id));
  const unlockedCount = visibleDefs.filter((def) => unlockedIds.has(def.id)).length;
  const completion = visibleDefs.length ? Math.round((unlockedCount / visibleDefs.length) * 100) : 0;
  const legendaryCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.rarity === "legendary").length;
  const hiddenCount = visibleDefs.filter((def) => unlockedIds.has(def.id) && def.hidden).length;
  const filteredDefs = visibleDefs.filter((def) => matchesAchievementFilters(def, unlockedIds));

  achievementSummaryElement.textContent = `${unlockedCount} / ${visibleDefs.length}`;

  achievementCategoryTabs?.querySelectorAll<HTMLButtonElement>("[data-achievement-category]").forEach((button) => {
    const active = button.dataset.achievementCategory === achievementCategoryFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  achievementStatusTabs?.querySelectorAll<HTMLButtonElement>("[data-achievement-status]").forEach((button) => {
    const active = button.dataset.achievementStatus === achievementStatusFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (achievementOverviewElement) {
    achievementOverviewElement.innerHTML = `
      <article>
        <span>完成率</span>
        <strong>${completion}%</strong>
      </article>
      <article>
        <span>已点亮</span>
        <strong>${unlockedCount}</strong>
      </article>
      <article>
        <span>传说</span>
        <strong>${legendaryCount}</strong>
      </article>
      <article>
        <span>隐藏</span>
        <strong>${hiddenCount}</strong>
      </article>
    `;
  }

  if (achievementRecentElement) {
    const showcase = visibleDefs
      .filter((def) => unlockedIds.has(def.id) && (def.rarity === "legendary" || def.rarity === "epic"))
      .sort((a, b) => rarityOrder(a.rarity) - rarityOrder(b.rarity));
    achievementRecentElement.innerHTML = showcase.length
      ? showcase
          .map(
            (def) =>
              `<button type="button" class="rarity-${def.rarity}" data-achievement-id="${escapeHtml(def.id)}">${escapeHtml(def.name)}</button>`,
          )
          .join("")
      : `<span>还没有高阶成就，等下一次点亮</span>`;
  }

  if (!filteredDefs.length) {
    achievementGridElement.innerHTML = `<div class="achievement-empty">这个筛选下还没有成就。</div>`;
    return;
  }

  achievementGridElement.innerHTML = CATEGORY_ORDER
    .map((cat) => {
      const defs = filteredDefs.filter((def) => def.category === cat);
      if (!defs.length) return "";
      const sorted = [...defs].sort((a, b) => {
        const aUnlocked = unlockedIds.has(a.id) ? 0 : 1;
        const bUnlocked = unlockedIds.has(b.id) ? 0 : 1;
        if (aUnlocked !== bUnlocked) return aUnlocked - bUnlocked;
        return rarityOrder(a.rarity) - rarityOrder(b.rarity);
      });
      return `
        <section class="achievement-category">
          <div class="achievement-category-title">
            <strong>${escapeHtml(ACHIEVEMENT_CATEGORY_LABELS[cat])}</strong>
            <span>${defs.filter((def) => unlockedIds.has(def.id)).length}/${defs.length}</span>
          </div>
          <div class="achievement-items">
            ${sorted.map((def) => achievementItemHtml(def, unlockedIds, unseenIds, stats, context)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function matchesAchievementFilters(def: AchievementDef, unlockedIds: Set<string>) {
  if (def.category !== achievementCategoryFilter) return false;
  const unlocked = unlockedIds.has(def.id);
  if (achievementStatusFilter === "unlocked") return unlocked;
  if (achievementStatusFilter === "locked") return !unlocked;
  if (achievementStatusFilter === "hidden") return def.hidden;
  return true;
}

function achievementItemHtml(
  def: AchievementDef,
  unlockedIds: Set<string>,
  unseenIds: Set<string>,
  stats?: Stats,
  context?: AchievementContext,
) {
  const unlocked = unlockedIds.has(def.id);
  const isNew = unlocked && unseenIds.has(def.id);
  const reveal = unlocked || !def.hidden;
  const lockedHidden = def.hidden && !unlocked;
  const progress = achievementProgress(def, stats, context);
  const rarityLabel = escapeHtml(ACHIEVEMENT_RARITY_LABELS[def.rarity]);
  const meta = def.planned ? "未开放" : rarityLabel;
  const markIcon = unlocked ? "✦" : lockedHidden ? "?" : "·";
  const conditionText = reveal ? def.description : "解锁后揭晓";
  return `
    <article class="achievement-item ${unlocked ? "unlocked" : "locked"} ${isNew ? "new" : ""} rarity-${def.rarity}" data-achievement-id="${def.id}">
      <div class="achievement-mark">${markIcon}</div>
      <div class="achievement-copy">
        <div>
          <strong>${escapeHtml(reveal ? def.name : "???")}</strong>
          <span>${meta}</span>
        </div>
        <p>${escapeHtml(conditionText)}</p>
        <div class="achievement-progress ${progress ? "" : "empty"}"><span style="width:${progress?.percent ?? 0}%"></span></div>
        <em>${escapeHtml(progress?.label ?? " ")}</em>
      </div>
      ${isNew ? `<span class="achievement-new-badge">NEW</span>` : ""}
    </article>
  `;
}

function showAchievementDetail(def: AchievementDef) {
  const unlockedIds = achievementUnlockedIds();
  const unlocked = unlockedIds.has(def.id);
  const reveal = unlocked || !def.hidden;
  const unlock = achievementState.unlocked.find((u) => u.id === def.id);
  const unlockDate = unlock ? new Date(unlock.unlockedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const rarityLabel = ACHIEVEMENT_RARITY_LABELS[def.rarity];
  const categoryLabel = ACHIEVEMENT_CATEGORY_LABELS[def.category];
  const markIcon = unlocked ? "✦" : def.hidden && !unlocked ? "?" : "·";

  const stats = ledger && tree && gameBalance ? calculateStats(ledger.entries, tree, gameBalance) : undefined;
  const context = stats ? buildAchievementContext(stats) : undefined;
  const progress = achievementProgress(def, stats, context);

  const existing = document.querySelector(".achievement-detail-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "achievement-detail-overlay";
  overlay.innerHTML = `
    <div class="achievement-detail-backdrop"></div>
    <div class="achievement-detail rarity-${def.rarity} ${unlocked ? "unlocked" : "locked"}">
      <button class="achievement-detail-close" type="button" aria-label="关闭">×</button>
      <div class="achievement-detail-mark">${markIcon}</div>
      <h3>${escapeHtml(reveal ? def.name : "???")}</h3>
      <span class="achievement-detail-rarity">${escapeHtml(rarityLabel)}</span>
      <p class="achievement-detail-condition">${escapeHtml(reveal ? def.description : "解锁后揭晓")}</p>
      ${reveal && def.flavor ? `<p class="achievement-detail-flavor">${escapeHtml(def.flavor)}</p>` : ""}
      <div class="achievement-detail-meta">
        <span>${escapeHtml(categoryLabel)}</span>
        ${unlockDate ? `<span>达成于 ${escapeHtml(unlockDate)}</span>` : `<span>未解锁</span>`}
      </div>
      ${progress ? `
        <div class="achievement-detail-progress">
          <div class="achievement-progress"><span style="width:${progress.percent}%"></span></div>
          <em>${escapeHtml(progress.label)}</em>
        </div>
      ` : ""}
    </div>
  `;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".achievement-detail-backdrop")?.addEventListener("click", close);
  overlay.querySelector(".achievement-detail-close")?.addEventListener("click", close);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function showLockedAchievementHint(target: HTMLElement) {
  const existing = document.querySelector(".locked-achievement-hint");
  if (existing) existing.remove();
  if (lockedAchievementHintTimer) window.clearTimeout(lockedAchievementHintTimer);

  const hint = document.createElement("div");
  hint.className = "locked-achievement-hint";
  hint.textContent = "未解锁";
  document.body.appendChild(hint);

  const itemRect = target.getBoundingClientRect();
  const hintRect = hint.getBoundingClientRect();
  const left = itemRect.left + itemRect.width / 2 - hintRect.width / 2;
  const top = itemRect.top - hintRect.height - 8;
  hint.style.left = `${clamp(left, 12, window.innerWidth - hintRect.width - 12)}px`;
  hint.style.top = `${Math.max(12, top)}px`;

  lockedAchievementHintTimer = window.setTimeout(() => {
    hint.remove();
    lockedAchievementHintTimer = undefined;
  }, 1200);
}

function achievementProgress(def: AchievementDef, stats?: Stats, context?: AchievementContext) {
  if (!stats) return undefined;
  const xpMatch = def.id.match(/^xp_(10k|100k|1m|10m|100m|1b)$/);
  const dailyMatch = def.id.match(/^daily_(1k|10k|50k|1m|10m|100m)$/);
  const burstMatch = def.id.match(/^burst_(60|10k|100k|1m)$/);
  const targetByKey: Record<string, number> = {
    "60": 60,
    "1k": 1_000,
    "10k": 10_000,
    "50k": 50_000,
    "100k": 100_000,
    "1m": 1_000_000,
    "10m": 10_000_000,
    "100m": 100_000_000,
    "1b": 1_000_000_000,
  };
  if (xpMatch) {
    const target = targetByKey[xpMatch[1]];
    return { percent: clamp((stats.xp / target) * 100, 0, 100), label: `${formatCompact(stats.xp)} / ${formatCompact(target)} XP` };
  }
  if (dailyMatch && context) {
    const target = targetByKey[dailyMatch[1]];
    return {
      percent: clamp((context.maxDailyXp / target) * 100, 0, 100),
      label: `${formatCompact(context.maxDailyXp)} / ${formatCompact(target)} XP`,
    };
  }
  if (burstMatch) {
    const target = targetByKey[burstMatch[1]];
    const peak = peakStat("peakXpPerMinute", stats.weather.tokensPerMinute);
    return {
      percent: clamp((peak / target) * 100, 0, 100),
      label: `${formatCompact(peak)} / ${formatCompact(target)} XP/min`,
    };
  }
  return undefined;
}

function peakStat(key: string, current: number): number {
  const stored = achievementState.stats?.[key];
  const prev = typeof stored === "number" ? stored : 0;
  return Math.max(prev, current);
}

let statsSyncInFlight = false;

function syncPeakStats(stats: Stats, context: AchievementContext) {
  if (statsSyncInFlight) return;
  const peaks: Record<string, number> = {
    peakXpPerMinute: stats.weather.tokensPerMinute,
    peakDailyXp: context.maxDailyXp,
  };
  const existing = achievementState.stats ?? {};
  const needsUpdate = Object.entries(peaks).some(
    ([key, value]) => value > (typeof existing[key] === "number" ? (existing[key] as number) : 0),
  );
  if (!needsUpdate) return;
  const merged: Record<string, number> = {};
  for (const [key, value] of Object.entries(peaks)) {
    merged[key] = Math.max(value, typeof existing[key] === "number" ? (existing[key] as number) : 0);
  }
  statsSyncInFlight = true;
  void window.bonsai
    .updateAchievementStats(merged)
    .then((state) => {
      achievementState = state;
    })
    .finally(() => {
      statsSyncInFlight = false;
    });
}

function syncAchievements(stats: Stats, context: AchievementContext) {
  if (!ledger || !tree || achievementSyncInFlight) return;
  syncPeakStats(stats, context);
  const unlockedIds = achievementUnlockedIds();
  const items = ACHIEVEMENTS.filter((def) => !def.planned && !unlockedIds.has(def.id) && def.condition(context)).map(
    (def) => ({
      id: def.id,
      trigger: def.trigger?.(context) ?? {
        xp: stats.xp,
        level: stats.level,
        at: new Date().toISOString(),
      },
    }),
  );
  if (!items.length) return;

  achievementSyncInFlight = true;
  void window.bonsai
    .unlockAchievements(items)
    .then((result) => {
      achievementState = result.state;
      queueAchievementToasts(result.unlocked.map((item) => item.id));
      renderAchievements(stats, context);
    })
    .finally(() => {
      achievementSyncInFlight = false;
    });
}

function buildAchievementContext(stats: Stats): AchievementContext {
  const entries = ledger?.entries ?? [];
  const dayXp = new Map<string, number>();
  const daySources = new Map<string, Set<HistorySourceId>>();
  const activeSources = new Set<HistorySourceId>();
  const sourceXp: Record<HistorySourceId, number> = { codex: 0, openclaw: 0, opencode: 0, claude: 0 };
  const hourSet = new Set<number>();
  const weekendDays = new Map<string, Set<number>>();
  const hourKeys = new Set<number>();
  let hasFibonacciSession = false;

  for (const entry of entries) {
    const xp = xpForEntry(entry);
    if (xp <= 0) continue;
    const createdAt = new Date(entry.createdAt);
    const key = dateKey(createdAt);
    dayXp.set(key, (dayXp.get(key) ?? 0) + xp);
    hourSet.add(createdAt.getHours());
    hourKeys.add(Math.floor(createdAt.getTime() / 3_600_000));
    if (isFibonacci(xp)) hasFibonacciSession = true;

    const source = historySourceId(entry);
    if (source) {
      activeSources.add(source);
      sourceXp[source] += xp;
      const sources = daySources.get(key) ?? new Set<HistorySourceId>();
      sources.add(source);
      daySources.set(key, sources);
    }

    if (createdAt.getDay() === 0 || createdAt.getDay() === 6) {
      const saturday = new Date(createdAt);
      const day = saturday.getDay();
      saturday.setDate(saturday.getDate() - (day === 0 ? 1 : 0));
      const weekendKey = dateKey(saturday);
      const days = weekendDays.get(weekendKey) ?? new Set<number>();
      days.add(day);
      weekendDays.set(weekendKey, days);
    }
  }

  const activeDayKeys = [...dayXp.keys()].sort();
  const maxDailyXp = Math.max(0, ...dayXp.values());
  const maxSourcesOneDay = Math.max(0, ...[...daySources.values()].map((sources) => sources.size));
  const stageIndex = tree ? tree.stages.findIndex((stage) => stage.id === stats.stage.id) : 0;

  return {
    stats,
    entries,
    stageIndex,
    maxDailyXp,
    consecutiveDays: longestConsecutiveDays(activeDayKeys),
    activeSources,
    maxSourcesOneDay,
    hasAgentSwitchWithinTenMinutes: hasAgentSwitchWithin(entries, 10 * 60 * 1000),
    sourceXp,
    hourSet,
    weekendWarrior: [...weekendDays.values()].some((days) => days.has(0) && days.has(6)),
    touchGrassReturn: hasReturnAfterInactiveGap(activeDayKeys, 7),
    coffeeOverdose: hasConsecutiveHourActivity(hourKeys, 8),
    hasFibonacciSession,
  };
}

function achievementUnlockedIds() {
  return new Set(achievementState.unlocked.map((item) => item.id));
}

function initializeSeenAchievements() {
  const unlockedIds = [...achievementUnlockedIds()];
  const stored = localStorage.getItem("vibe-tree:seen-achievements");
  if (!stored) {
    seenAchievementIds = new Set(unlockedIds);
    persistSeenAchievements();
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    seenAchievementIds = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    seenAchievementIds = new Set(unlockedIds);
    persistSeenAchievements();
  }
}

function persistSeenAchievements() {
  localStorage.setItem("vibe-tree:seen-achievements", JSON.stringify([...seenAchievementIds]));
}

function markAchievementSeen(id: string) {
  if (seenAchievementIds.has(id)) return;
  seenAchievementIds.add(id);
  persistSeenAchievements();
  renderAchievements();
}

function queueAchievementToasts(ids: string[]) {
  const defs = ids.map((id) => ACHIEVEMENTS.find((def) => def.id === id)).filter((def): def is AchievementDef => Boolean(def));
  if (!defs.length) return;
  achievementToastQueue.push(...defs);
  showNextAchievementToast();
}

function previewAchievementToast() {
  const id = TOAST_PREVIEW_IDS[toastPreviewIndex % TOAST_PREVIEW_IDS.length];
  toastPreviewIndex += 1;
  void window.bonsai.previewAchievementToast(id);
}

function showNextAchievementToast() {
  if (!achievementToastLayer || achievementToastTimer) return;
  if (!achievementToastQueue.length) {
    if (viewMode === "toast") window.bonsai.notifyAchievementToastDrained();
    return;
  }
  const def = achievementToastQueue.shift()!;
  achievementToastLayer.innerHTML = `
    <div class="achievement-toast rarity-${def.rarity}">
      <span>${ACHIEVEMENT_RARITY_LABELS[def.rarity]} · 成就解锁</span>
      <strong>${escapeHtml(def.name)}</strong>
      <p>${escapeHtml(def.description)}</p>
    </div>
  `;
  achievementToastTimer = window.setTimeout(() => {
    achievementToastLayer.innerHTML = "";
    achievementToastTimer = undefined;
    showNextAchievementToast();
  }, ACHIEVEMENT_TOAST_DURATION_MS);
}

function longestConsecutiveDays(keys: string[]) {
  let best = 0;
  let current = 0;
  let previous = 0;
  for (const key of keys) {
    const time = Date.parse(`${key}T00:00:00`);
    if (!Number.isFinite(time)) continue;
    current = previous && time - previous === 86_400_000 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = time;
  }
  return best;
}

function hasReturnAfterInactiveGap(keys: string[], gapDays: number) {
  for (let index = 1; index < keys.length; index += 1) {
    const previous = Date.parse(`${keys[index - 1]}T00:00:00`);
    const current = Date.parse(`${keys[index]}T00:00:00`);
    if (Number.isFinite(previous) && Number.isFinite(current) && current - previous >= (gapDays + 1) * 86_400_000) {
      return true;
    }
  }
  return false;
}

function hasConsecutiveHourActivity(hourKeys: Set<number>, target: number) {
  const sorted = [...hourKeys].sort((a, b) => a - b);
  let streak = 0;
  let previous: number | undefined;
  for (const key of sorted) {
    streak = previous !== undefined && key - previous === 1 ? streak + 1 : 1;
    if (streak >= target) return true;
    previous = key;
  }
  return false;
}

function hasAgentSwitchWithin(entries: LedgerEntry[], windowMs: number) {
  const sorted = entries
    .map((entry) => ({ time: new Date(entry.createdAt).getTime(), source: historySourceId(entry) }))
    .filter((item): item is { time: number; source: HistorySourceId } => Boolean(item.source) && Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].source !== sorted[index - 1].source && sorted[index].time - sorted[index - 1].time <= windowMs) {
      return true;
    }
  }
  return false;
}

function isFibonacci(value: number) {
  const rounded = Math.round(value);
  if (rounded < 2 || rounded > 10_000_000) return false;
  let a = 1;
  let b = 1;
  while (b < rounded) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b === rounded;
}

function renderLevelBadge(
  selector: string,
  stats: Stats,
  frontMetric: BadgeMetric,
  backMetric: BadgeMetric,
  totalUnit: TotalDisplayUnit,
) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  const front = badge.querySelector<HTMLElement>(".badge-front");
  const back = badge.querySelector<HTMLElement>(".badge-back");
  if (!front || !back) return;

  const frontText = badgeMetricText(frontMetric, stats, totalUnit);
  const backText = badgeMetricText(backMetric, stats, totalUnit);
  front.textContent = frontText;
  back.textContent = backText;
  badge.style.setProperty("--badge-front-width", `${badgeWidthForText(frontText)}px`);
  badge.style.setProperty("--badge-back-width", `${badgeWidthForText(backText)}px`);
  front.style.fontSize = badgeFontSizeForText(frontText);
  back.style.fontSize = badgeFontSizeForText(backText);
}

function badgeMetricText(metric: BadgeMetric, stats: Stats, totalUnit: TotalDisplayUnit) {
  if (metric === "level") return `Lv.${stats.level}`;
  if (metric === "rate") return `${formatIntegerWithCommas(stats.weather.tokensPerMinute / 60)}/s`;
  return formatByUnit(stats.xp, totalUnit);
}

function badgeWidthForText(...values: string[]) {
  const longest = Math.max(...values.map((value) => value.length));
  return clamp(54 + Math.max(0, longest - 5) * 7, 54, 104);
}

function badgeFontSizeForText(value: string) {
  if (value.length >= 13) return "0.48rem";
  if (value.length >= 11) return "0.54rem";
  if (value.length >= 9) return "0.6rem";
  return "";
}

function startAutoBadgeFlipLoop() {
  if (badgeAutoFlipTimer) return;
  const selector = viewMode === "pet" ? "#petLevelBadge" : "#previewLevelBadge";
  badgeAutoFlipTimer = window.setInterval(() => {
    flipLevelBadgeTemporarily(selector);
  }, AUTO_BADGE_FLIP_MS);
}

function flipLevelBadgeTemporarily(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;

  clearBadgeFlipTimer(selector);
  badge.classList.add("level-badge-show-total");
  const timer = window.setTimeout(() => {
    badge.classList.remove("level-badge-show-total");
    badgeFlipTimers.delete(selector);
  }, BADGE_TOKEN_HOLD_MS);
  badgeFlipTimers.set(selector, timer);
}

function showLevelBadgeBack(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  clearBadgeFlipTimer(selector);
  badge.classList.add("level-badge-show-total");
}

function hideLevelBadgeBack(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  clearBadgeFlipTimer(selector);
  badge.classList.remove("level-badge-show-total");
}

function clearBadgeFlipTimer(selector: string) {
  const timer = badgeFlipTimers.get(selector);
  if (!timer) return;
  window.clearTimeout(timer);
  badgeFlipTimers.delete(selector);
}

function renderWeatherLayers(weather: WeatherId) {
  const back = weatherBackHtml(weather);
  const front = weatherFrontHtml(weather);
  if (weatherBack) weatherBack.innerHTML = back;
  if (weatherFront) weatherFront.innerHTML = front;
  if (previewWeatherBack) previewWeatherBack.innerHTML = back;
  if (previewWeatherFront) previewWeatherFront.innerHTML = front;
}

function renderUsageStatus() {
  if (!usageStatus) return;
  if (ledger) {
    renderScopedSourceBreakdown();
  }
}

function renderScopedSourceBreakdown() {
  if (!ledger) return;
  renderSourceBreakdown(getSourceBreakdown(getSourceScopeEntries(ledger.entries)));
}

function renderSourceBreakdown(rows: SourceBreakdown[]) {
  const element = document.querySelector<HTMLElement>("#sourceBreakdown");
  if (!element) return;
  syncSourceScopeTabs();
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  const activeSources = rows.filter((row) => row.xp > 0).length;
  text(
    "#sourceSummary",
    activeSources
      ? `${activeSources} ${sourceScope === "today" ? "个来源今日有记录" : "个来源有记录"}`
      : sourceScope === "today"
        ? "今日等待 token"
        : "等待 token",
  );
  element.innerHTML = getMonitorSourceRows(rows)
    .map((row) => {
      const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
      const expanded = expandedSourceKey === row.sourceKey;
      return `
        <article class="source-row ${expanded ? "expanded" : ""}" data-source-key="${escapeHtml(row.sourceKey)}" aria-expanded="${expanded}">
          <div class="source-main">
            <div>
              <strong>${escapeHtml(row.label)}</strong>
              <span class="source-meta">${escapeHtml(row.meta)}</span>
            </div>
            <span class="source-status ${row.statusClass}">${escapeHtml(row.status)}</span>
          </div>
          <div class="source-usage">
            <div>
              <strong>${formatCompact(row.xp)} XP</strong>
              <span>${row.xp > 0 ? `${percent}%` : "无记录"}</span>
            </div>
            <div class="source-meter"><span style="width:${percent}%"></span></div>
            <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
          </div>
          ${expanded ? renderModelBreakdown(row.sourceKey) : ""}
        </article>
      `;
    })
    .join("");
}

function syncSourceScopeTabs() {
  sourceScopeTabs?.querySelectorAll<HTMLButtonElement>("[data-source-scope]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sourceScope === sourceScope);
  });
}

type SourceRowView = SourceBreakdown & {
  sourceKey: string;
  status: string;
  statusClass: string;
  meta: string;
};

function getMonitorSourceRows(rows: SourceBreakdown[]): SourceRowView[] {
  const monitors = [
    {
      sourceKey: "codex",
      label: "Codex",
      status: usageStatus?.codexSession,
      match: (row: SourceBreakdown) => row.id === "codex-desktop" || row.id === "codex-session" || row.label === "Codex",
    },
    {
      sourceKey: "claude",
      label: "Claude Code",
      status: usageStatus?.claudeSession,
      match: (row: SourceBreakdown) =>
        row.id === "claude-code" ||
        row.id === "claude-session" ||
        row.label === "Claude Code" ||
        row.id.startsWith("claude-code:"),
    },
    {
      sourceKey: "openclaw",
      label: "OpenClaw",
      status: usageStatus?.openclawSession,
      match: (row: SourceBreakdown) => row.id === "openclaw" || row.id === "openclaw-session" || row.label === "OpenClaw",
    },
    {
      sourceKey: "opencode",
      label: "OpenCode",
      status: usageStatus?.opencodeSession,
      match: (row: SourceBreakdown) =>
        row.id === "opencode" || row.id === "opencode-session" || row.label === "OpenCode" || row.id.startsWith("opencode:"),
    },
  ];
  const used = new Set<SourceBreakdown>();
  const monitorRows = monitors.map((monitor) => {
    const matches = rows.filter((row) => monitor.match(row));
    matches.forEach((row) => used.add(row));
    return {
      ...combineSourceRows(monitor.label, matches),
      sourceKey: monitor.sourceKey,
      ...monitorStatusView(monitor.status),
    };
  });
  return monitorRows;
}

function combineSourceRows(label: string, rows: SourceBreakdown[]): SourceBreakdown {
  return rows.reduce(
    (total, row) => ({
      ...total,
      xp: total.xp + row.xp,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
    }),
    { id: label, label, xp: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function monitorStatusView(status: UsageStatus["codexSession"] | undefined) {
  if (!status) return { status: "检查中", statusClass: "pending", meta: "正在读取本机记录" };
  const running = status.exists && status.running;
  return {
    status: running ? "在线" : "离线",
    statusClass: running ? "running" : "missing",
    meta: `${status.filesWatched} 个文件 · ${status.lastEventAt ? formatRelativeTime(status.lastEventAt) : "等待新 token"}`,
  };
}

function renderModelBreakdown(sourceKey: string) {
  const rows = getModelBreakdown(sourceKey);
  if (!rows.length) {
    return `<div class="model-breakdown empty">还没有模型记录</div>`;
  }
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  return `
    <div class="model-breakdown">
      <div class="model-breakdown-title">模型占比</div>
      ${rows
        .map((row) => {
          const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
          return `
            <div class="model-row">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span>${formatCompact(row.xp)} XP · ${percent}%</span>
              </div>
              <div class="source-meter"><span style="width:${percent}%"></span></div>
              <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getModelBreakdown(sourceKey: string) {
  if (!ledger) return [];
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of getSourceScopeEntries(ledger.entries)) {
    if (!entryMatchesSourceKey(entry, sourceKey)) continue;
    const model = entry.model || entry.provider || "unknown";
    const existing =
      rows.get(model) ??
      {
        id: model,
        label: model,
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    existing.xp += xpForEntry(entry);
    existing.inputTokens += safeTokens(entry.inputTokens ?? 0);
    existing.outputTokens += safeTokens(entry.outputTokens ?? 0);
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    rows.set(model, existing);
  }
  return [...rows.values()].filter((row) => row.xp > 0).sort((a, b) => b.xp - a.xp);
}

function getSourceScopeEntries(entries: LedgerEntry[]) {
  if (sourceScope === "total") return entries;
  const todayKey = dateKey(new Date());
  return entries.filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey);
}

function entryMatchesSourceKey(entry: LedgerEntry, sourceKey: string) {
  if (sourceKey === "codex") return entry.source === "codex-session" || entry.agent === "codex-desktop";
  if (sourceKey === "claude") return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
  if (sourceKey === "openclaw") return entry.source === "openclaw-session" || entry.agent === "openclaw";
  if (sourceKey === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  if (sourceKey.startsWith("source:")) {
    const id = sourceKey.slice("source:".length);
    const entryId = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    return entryId === id;
  }
  return false;
}

function buildTreeAsset(manifest: PureSvgManifest): TreeAsset {
  const labels: Record<string, string> = {
    sprout: "新芽",
    seedling: "幼苗",
    young: "小树",
    medium: "成长期",
    lush: "繁茂",
    full: "完全体",
  };

  return {
    id: "vibe-bonsai",
    displayName: "Vibe Tree",
    baseSize: { width: 96, height: 96 },
    defaultScale: 2,
    palette: {
      leaf: "#5bbf7a",
      rain: "#78b7d8",
      storm: "#fff2a8",
      soilGlow: "#f2a541",
      wind: "#d7f7d0",
    },
    stages: manifest.stages.map((stage) => ({
      id: stage.id,
      label: labels[stage.id] ?? stage.label,
      image: stage.asset,
    })),
  };
}

function calculateStats(entries: LedgerEntry[], asset: TreeAsset, balance: GameBalance): Stats {
  const now = Date.now();
  const peakWindowAgo = now - balance.activity.peakWindowSeconds * 1000;
  const activeWindowAgo = now - balance.activity.activeWindowSeconds * 1000;
  const todayKey = dateKey(new Date());
  const xp = entries.reduce((total, entry) => total + xpForEntry(entry), 0);
  const todayXp = entries
    .filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const lastFiveMinuteXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= peakWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const recentXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= activeWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const activeSessions = getActiveSessionCount(entries, activeWindowAgo);
  const levelState = getLevelState(xp, balance);
  const stageInfo = getStageForLevel(levelState.level, balance);
  const stage = asset.stages.find((item) => item.id === stageInfo.id) ?? asset.stages[0];
  const nextStage = getNextStageForLevel(levelState.level, balance);
  const stageProgress = getStageProgress(levelState.level, balance);
  const weather = getWeather(getWeatherRate(entries, now, balance), balance);

  return {
    xp,
    todayXp,
    level: levelState.level,
    levelXp: levelState.levelXp,
    nextLevelXp: levelState.nextLevelXp,
    levelProgress: levelState.progress,
    stage,
    nextStageLabel: nextStage?.label,
    stageProgress,
    weather,
    lastFiveMinuteXp,
    recentXp,
    activeSessions,
    sevenDays: getSevenDayRows(entries),
    sourceBreakdown: getSourceBreakdown(entries),
  };
}

function getLevelState(totalXp: number, balance: GameBalance) {
  let level = 1;
  let remaining = totalXp;
  let needed = xpForNextLevel(level, balance);
  while (remaining >= needed && level < balance.xp.maxLevel) {
    remaining -= needed;
    level += 1;
    needed = xpForNextLevel(level, balance);
  }
  return {
    level,
    levelXp: remaining,
    nextLevelXp: needed,
    progress: needed ? clamp(remaining / needed, 0, 1) : 1,
  };
}

function xpForNextLevel(level: number, balance: GameBalance) {
  return Math.round(balance.xp.levelBase * level ** balance.xp.levelExponent);
}

function getStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.reduce((current, stage) => (level >= stage.minLevel ? stage : current), balance.stages[0]);
}

function getNextStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.find((stage) => stage.minLevel > level);
}

function getStageProgress(level: number, balance: GameBalance) {
  const current = getStageForLevel(level, balance);
  const next = getNextStageForLevel(level, balance);
  if (!next) return 1;
  return clamp((level - current.minLevel) / (next.minLevel - current.minLevel), 0, 1);
}

function getWeatherRate(entries: LedgerEntry[], now: number, balance: GameBalance) {
  const recentTokens = getWindowXp(entries, now, balance.weather.rateWindowSeconds);
  return (recentTokens / balance.weather.rateWindowSeconds) * 60;
}

function getWindowXp(entries: LedgerEntry[], now: number, seconds: number) {
  return entries.reduce((total, entry) => {
    const ageSeconds = Math.max(0, (now - new Date(entry.createdAt).getTime()) / 1000);
    if (ageSeconds > seconds) return total;
    return total + xpForEntry(entry);
  }, 0);
}

function getActiveSessionCount(entries: LedgerEntry[], since: number) {
  const sessions = new Set<string>();
  for (const entry of entries) {
    if (new Date(entry.createdAt).getTime() < since) continue;
    if (xpForEntry(entry) <= 0) continue;
    sessions.add(entry.agent || entry.source);
  }
  return sessions.size;
}

function getWeather(tokensPerMinute: number, balance: GameBalance): WeatherState {
  const state = balance.weather.thresholds.reduce((current, candidate) => {
    return tokensPerMinute >= candidate.minXpPerMinute ? candidate : current;
  }, balance.weather.thresholds[0]);
  const maxWeatherRate = balance.weather.thresholds[balance.weather.thresholds.length - 1]?.minXpPerMinute || 1;
  return {
    id: state.id,
    label: state.label,
    tokensPerMinute,
    activity: clamp(tokensPerMinute / maxWeatherRate, 0, 1),
  };
}

function getSevenDayRows(entries: LedgerEntry[], filter: HistoryFilter = "all") {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date);
    const dayEntries = entries.filter(
      (entry) => sourceMatchesHistoryFilter(entry, filter) && dateKey(new Date(entry.createdAt)) === key,
    );
    const inputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.inputTokens ?? 0), 0);
    const outputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.outputTokens ?? 0), 0);
    const cacheReadTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheReadTokens ?? 0), 0);
    const cacheWriteTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheWriteTokens ?? 0), 0);
    const tokens = dayEntries.reduce((total, entry) => total + xpForEntry(entry), 0);
    const sources: Record<HistorySourceId, number> = { codex: 0, openclaw: 0, opencode: 0, claude: 0 };
    for (const entry of dayEntries) {
      const source = historySourceId(entry);
      if (source) sources[source] += xpForEntry(entry);
    }
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      sources,
    };
  });
}

function historySourceId(entry: LedgerEntry): HistorySourceId | undefined {
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  return undefined;
}

function sourceMatchesHistoryFilter(entry: LedgerEntry, filter: HistoryFilter) {
  if (filter === "all") return true;
  if (filter === "codex") {
    return entry.source === "codex-session" || entry.agent === "codex-desktop";
  }
  if (filter === "openclaw") {
    return entry.source === "openclaw-session" || entry.agent === "openclaw";
  }
  if (filter === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
}

function getSourceBreakdown(entries: LedgerEntry[]): SourceBreakdown[] {
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of entries) {
    const id = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    const existing =
      rows.get(id) ??
      {
        id,
        label: sourceLabel(id, entry.source),
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    const inputTokens = safeTokens(entry.inputTokens ?? 0);
    const outputTokens = safeTokens(entry.outputTokens ?? 0);
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    existing.xp += xpForEntry(entry);
    rows.set(id, existing);
  }
  return [...rows.values()].sort((a, b) => b.xp - a.xp);
}

function sourceLabel(id: string, source: string) {
  if (source === "manual") return "手动喂养";
  if (id.startsWith("claude-code:")) return `Claude ${id.replace("claude-code:", "")}`;
  if (id === "claude-code" || source === "claude-session") return "Claude Code";
  if (id === "codex-desktop" || source === "codex-session") return "Codex";
  if (id === "openclaw" || source === "openclaw-session") return "OpenClaw";
  if (id.startsWith("opencode:")) return `OpenCode ${id.replace("opencode:", "")}`;
  if (id === "opencode" || source === "opencode-session") return "OpenCode";
  return id;
}

function renderHistoryChart(rows: HistoryDayRow[], filter: HistoryFilter) {
  const labels: Record<HistoryFilter, string> = {
    all: "全部来源",
    codex: "Codex",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    claude: "Claude Code",
  };
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = Math.max(1, ...rows.map((row) => row.tokens));

  text("#historySummary", `${labels[filter]} · ${formatCompact(total)} XP`);
  if (historyLegend) historyLegend.innerHTML = filter === "all" ? historyAgentLegendHtml() : historyTokenLegendHtml();

  historyTabs?.querySelectorAll<HTMLButtonElement>("[data-history-filter]").forEach((button) => {
    const active = button.dataset.historyFilter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!historyBars) return;
  const chartKey = historyChartKey(rows, filter);
  if (chartKey === lastHistoryChartKey && historyBars.childElementCount > 0) return;
  lastHistoryChartKey = chartKey;
  historyBars.innerHTML = rows
    .map((row) => {
      const segmentTotal = filter === "all" ? row.tokens : row.tokens + row.cacheReadTokens + row.cacheWriteTokens;
      const height = row.tokens > 0 ? scaledHistoryHeight(row.tokens, max) : 0;
      const segments =
        filter === "all"
          ? `
              <span class="history-segment codex" style="height:${segmentPercent(row.sources.codex, segmentTotal)}%"></span>
              <span class="history-segment openclaw" style="height:${segmentPercent(row.sources.openclaw, segmentTotal)}%"></span>
              <span class="history-segment opencode" style="height:${segmentPercent(row.sources.opencode, segmentTotal)}%"></span>
              <span class="history-segment claude" style="height:${segmentPercent(row.sources.claude, segmentTotal)}%"></span>
            `
          : `
              <span class="history-segment input" style="height:${segmentPercent(row.inputTokens, segmentTotal)}%"></span>
              <span class="history-segment output" style="height:${segmentPercent(row.outputTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-read" style="height:${segmentPercent(row.cacheReadTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-write" style="height:${segmentPercent(row.cacheWriteTokens, segmentTotal)}%"></span>
            `;
      return `
        <article class="history-day" tabindex="0">
          <div class="history-bar-shell">
            <div class="history-stack" style="height:${height}%">
              ${segments}
            </div>
          </div>
          ${historyTooltipHtml(row, filter)}
          <strong>${formatCompact(row.tokens)}</strong>
          <span>${row.label}</span>
        </article>
      `;
    })
    .join("");
}

function historyChartKey(rows: HistoryDayRow[], filter: HistoryFilter) {
  return JSON.stringify({
    filter,
    rows: rows.map((row) => [
      row.label,
      row.tokens,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.sources.codex,
      row.sources.openclaw,
      row.sources.opencode,
      row.sources.claude,
    ]),
  });
}

function historyTooltipHtml(row: HistoryDayRow, filter: HistoryFilter) {
  const items =
    filter === "all"
      ? [
          { label: "Codex", value: row.sources.codex, tone: "codex" },
          { label: "OpenClaw", value: row.sources.openclaw, tone: "openclaw" },
          { label: "OpenCode", value: row.sources.opencode, tone: "opencode" },
          { label: "Claude", value: row.sources.claude, tone: "claude" },
        ]
      : [
          { label: "input", value: row.inputTokens, tone: "input" },
          { label: "output", value: row.outputTokens, tone: "output" },
          { label: "cache hit", value: row.cacheReadTokens, tone: "cache-read" },
          { label: "cache write", value: row.cacheWriteTokens, tone: "cache-write" },
        ];

  return `
    <div class="history-tooltip" role="tooltip">
      <div class="history-tooltip-head">
        <span>${escapeHtml(row.label)}</span>
        <strong>${formatCompact(row.tokens)} XP</strong>
      </div>
      <div class="history-tooltip-items">
        ${items
          .map(
            (item) => `
              <span class="${item.value > 0 ? "" : "empty"}">
                <i class="history-tooltip-dot ${item.tone}"></i>
                <b>${escapeHtml(item.label)}</b>
                <em>${formatCompact(item.value)}</em>
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function historyTokenLegendHtml() {
  return `
    <span><i class="legend-input"></i>input</span>
    <span><i class="legend-output"></i>output</span>
    <span><i class="legend-cache-read"></i>cache hit</span>
    <span><i class="legend-cache-write"></i>cache write</span>
  `;
}

function historyAgentLegendHtml() {
  return `
    <span><i class="legend-codex"></i>Codex</span>
    <span><i class="legend-openclaw"></i>OpenClaw</span>
    <span><i class="legend-opencode"></i>OpenCode</span>
    <span><i class="legend-claude"></i>Claude Code</span>
  `;
}

function segmentPercent(value: number, total: number) {
  if (value <= 0 || total <= 0) return 0;
  return Math.max(4, Math.round((value / total) * 100));
}

function scaledHistoryHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return clamp((value / max) * 100, 1.5, 100);
}

function xpForEntry(entry: LedgerEntry) {
  if (
    entry.inputTokens === undefined &&
    entry.outputTokens === undefined &&
    entry.cacheReadTokens === undefined &&
    entry.cacheWriteTokens === undefined
  ) {
    return safeTokens(entry.tokens);
  }

  return safeTokens(entry.inputTokens ?? 0) + safeTokens(entry.outputTokens ?? 0);
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeBadgeMetric(value: string, fallback: BadgeMetric): BadgeMetric {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: string): TotalDisplayUnit {
  return value === "raw" || value === "k" || value === "m" || value === "wan" || value === "yi" ? value : "m";
}

function formatByUnit(value: number, unit: TotalDisplayUnit) {
  const safeValue = Math.max(0, value);
  if (unit === "raw") return formatIntegerWithCommas(safeValue);
  if (unit === "wan") return `${formatScaledUnit(safeValue, 10_000)}万`;
  if (unit === "yi") return `${formatScaledUnit(safeValue, 100_000_000)}亿`;
  const divisor = unit === "m" ? 1_000_000 : 1_000;
  return `${formatIntegerWithCommas(Math.round(safeValue / divisor))}${unit}`;
}

function formatScaledUnit(value: number, divisor: number) {
  const scaled = value / divisor;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(scaled);
}

function formatIntegerWithCommas(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function weatherBackHtml(weather: WeatherId) {
  if (weather === "drizzle") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(118, 34, false, "small")}</svg>`;
  }
  if (weather === "rain") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(56, 34, false, "medium")}</svg>`;
  }
  if (weather === "thunder" || weather === "storm") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(weather === "storm" ? 102 : 104, weather === "storm" ? 32 : 30, true, weather === "storm" ? "wide" : "thunder")}</svg>`;
  }
  return "";
}

function weatherFrontHtml(weather: WeatherId) {
  if (weather === "clear") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="sun">${sunIcon(34, 34)}</g>
        <g class="spark-a">${tinySpark(36, 108)}${tinySpark(82, 84)}</g>
        <g class="spark-b">${tinySpark(146, 98)}</g>
      </svg>
    `;
  }
  if (weather === "breeze") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="wind-a">${windLine(118, 68, 24)}${windLine(110, 84, 30)}</g>
        <g class="wind-b">${windLine(124, 100, 22)}${leafBit(76, 96)}${leafBit(132, 94)}</g>
      </svg>
    `;
  }
  if (weather === "drizzle") {
    return `<svg class="weather-svg" viewBox="0 0 192 192"><g class="rain-slow">${drop(114, 56)}${drop(134, 68)}${drop(152, 86)}${drop(150, 116)}</g></svg>`;
  }
  if (weather === "rain") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  if (weather === "thunder") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
        <g class="bolt">${boltIcon(132, 58)}</g>
      </svg>
    `;
  }
  if (weather === "storm") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slant">${slantDrop(76, 70)}${slantDrop(100, 66)}${slantDrop(124, 72)}${slantDrop(146, 84)}${slantDrop(154, 104)}</g>
        <g class="wind-a">${windLine(56, 112, 28)}${windLine(52, 128, 22)}</g>
        <g class="wind-b">${windLine(112, 124, 30)}${leafBit(150, 92)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  return "";
}

function px(x: number, y: number, w: number, h: number, fill: string) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function tinySpark(x: number, y: number) {
  return `${px(x, y + 4, 10, 4, "#ffd239")}${px(x + 3, y, 4, 12, "#ffd239")}`;
}

function sunIcon(x: number, y: number) {
  return `
    ${px(x, y, 17, 17, "#ffd239")}
    ${px(x + 5, y - 8, 5, 5, "#ffc928")}
    ${px(x + 5, y + 20, 5, 5, "#ffc928")}
    ${px(x - 8, y + 6, 5, 5, "#ffc928")}
    ${px(x + 20, y + 6, 5, 5, "#ffc928")}
    ${px(x + 4, y + 4, 8, 8, "#fff07a")}
  `;
}

function windLine(x: number, y: number, w: number) {
  return px(x, y, w, 4, "#b9e8f4");
}

function leafBit(x: number, y: number) {
  return px(x, y, 5, 5, "#83b93c");
}

function drop(x: number, y: number) {
  return px(x, y, 4, 14, "#86cbed");
}

function slantDrop(x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="4" height="18" fill="#86cbed" transform="rotate(28 ${x} ${y})"/>`;
}

function puddle(x: number, y: number) {
  return `${px(x, y, 15, 4, "#5dbde7")}${px(x + 3, y - 2, 7, 2, "#9fe4ff")}`;
}

function boltIcon(x: number, y: number) {
  return `
    <polygon points="${x + 10},${y} ${x + 24},${y} ${x + 16},${y + 20} ${x + 26},${y + 20} ${x + 2},${y + 52} ${x + 10},${y + 28} ${x},${y + 28}" fill="#070807"/>
    <polygon points="${x + 12},${y + 4} ${x + 20},${y + 4} ${x + 12},${y + 24} ${x + 22},${y + 24} ${x + 6},${y + 44} ${x + 12},${y + 24} ${x + 4},${y + 24}" fill="#ffc928"/>
    ${px(x + 13, y + 6, 5, 7, "#fff07a")}
  `;
}

function cloud(x: number, y: number, dark: boolean, size: "small" | "medium" | "wide" | "thunder") {
  const main = dark ? "#66707a" : "#aebfca";
  const mid = dark ? "#505860" : "#7f929f";
  const hi = dark ? "#929ba3" : "#dfe9ee";
  const scale = size === "small" ? 0.72 : size === "wide" ? 0.92 : size === "thunder" ? 0.96 : 0.82;
  const sx = (value: number) => Math.round(value * scale);
  return `
    <g class="cloud" transform="translate(${x} ${y})">
      ${px(-sx(4), sx(22), sx(70), sx(18), "#070807")}
      ${px(sx(8), sx(10), sx(48), sx(24), "#070807")}
      ${px(sx(2), sx(24), sx(62), sx(12), main)}
      ${px(sx(14), sx(14), sx(40), sx(18), main)}
      ${px(sx(20), sx(14), sx(15), sx(6), hi)}
      ${px(sx(42), sx(24), sx(16), sx(8), mid)}
      ${px(sx(4), sx(32), sx(18), sx(8), mid)}
    </g>
  `;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function formatCompact(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;

  const units = [
    { value: 1_000_000_000, suffix: "b" },
    { value: 1_000_000, suffix: "m" },
    { value: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absolute >= item.value);
  if (!unit) return `${Math.round(value)}`;

  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return `${sign}${formatted}${unit.suffix}`;
}

function assetUrl(path: string) {
  if (location.protocol !== "file:" || !path.startsWith("/")) return path;
  return path.slice(1);
}

function formatRelativeTime(isoTime: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000));
  if (elapsedSeconds < 5) return "刚刚";
  if (elapsedSeconds < 60) return `${elapsedSeconds} 秒前`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours} 小时前`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function text(selector: string, value: string) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function syncInputValue(input: HTMLInputElement | null, value: string) {
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `<pre class="fatal">${String(error)}</pre>`;
});
