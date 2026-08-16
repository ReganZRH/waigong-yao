// ============ 吃药提醒 App 配置（改这里即可调整药品和时间） ============
const APP_CONFIG = {
  appName: "外公吃药",

  // 早 / 中 / 晚三个时间段（时间用 24 小时制 HH:mm）
  periods: [
    { id: "morning", label: "早", time: "06:00" },
    { id: "noon", label: "中", time: "12:00" },
    { id: "evening", label: "晚", time: "18:00" }
  ],

  // 药品名单与每次用量（按外公医嘱填写）
  medicines: [
    { name: "尿感灵", dose: "1袋" },
    { name: "甲钴胺", dose: "1片" },
    { name: "营养粉", dose: "1份" },
    { name: "氯化钾", dose: "1片" },
    { name: "维生素B", dose: "1片" },
    { name: "益生菌", dose: "3片" }
  ],

  // 每个时间段吃哪些药（按上面的药品 name）
  slots: {
    morning: ["尿感灵", "甲钴胺", "营养粉", "氯化钾", "维生素B", "益生菌"],
    noon: ["尿感灵", "氯化钾", "益生菌"],
    evening: ["尿感灵", "甲钴胺", "营养粉", "氯化钾", "益生菌"]
  },

  // 未确认时每 3 小时提醒一次
  reRemindHours: 3,

  // 安静时段：22:00 - 5:59 不弹提醒（不打扰睡觉）
  quietStartHour: 22,
  quietEndHour: 6,

  // 同步服务（Supabase 免费版）
  supabaseUrl: "https://hvgkuggrngbxoqhvujxu.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2Z2t1Z2dybmdieG9xaHZ1anh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODExNDgsImV4cCI6MjEwMjQ1NzE0OH0.emEqb_d0JL21CC2TWboJUYW2o2Sh1tSPz66j0ZECflI",

  // 同步间隔（秒）
  pollIntervalSec: 30
};
