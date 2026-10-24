/**
 * Starter capacity notes. Each is plain text in the calculator's own syntax: the user edits the lines like any note.
 *
 * Layout of every template: a title comment, an ASSUMPTIONS block (each line `name = number`, a guess to be replaced with the real figure,
 * never a fact), then DERIVED lines that only reference the assumptions above them. Nothing here is a statement about any real product.
 * Lazy chunk: reached only from the capacity-note picker, never from the entry.
 */
export interface CalcTemplate { id: string; title: string; blurb: string; text: string }

const ASSUME = "# ASSUMPTIONS: guesses, not facts. Replace each number with your own.";
const DERIVED = "# DERIVED: calculated from the lines above, do not type over";

/** the rows every template shares, in the same order and with the same names, so a reader learns them once */
const COMMON_ASSUMPTIONS = (a: { dau: string; writes: string; ratio: string; size: string; retention: string; peak: string; hot: string; rps: string }): string[] => [
  `dau = ${a.dau}`,
  `writes_per_user_per_day = ${a.writes}`,
  `read_write_ratio = ${a.ratio}`,
  `object_size = ${a.size}`,
  `retention_days = ${a.retention}`,
  "replication_factor = 3",
  `peak_factor = ${a.peak}`,
  `hot_fraction = ${a.hot}`,
  `rps_per_server = ${a.rps}`,
];

const COMMON_DERIVED = [
  "writes_per_day = dau * writes_per_user_per_day",
  "reads_per_day = writes_per_day * read_write_ratio",
  "avg_write_qps = writes_per_day / day",
  "avg_read_qps = reads_per_day / day",
  "peak_write_qps = avg_write_qps * peak_factor",
  "peak_read_qps = avg_read_qps * peak_factor",
  "storage_per_day = writes_per_day * object_size",
  "storage_retained = storage_per_day * retention_days * replication_factor",
  "ingress_peak = peak_write_qps * object_size",
  "egress_peak = peak_read_qps * object_size",
  "cache_memory = reads_per_day * object_size * hot_fraction",
  "servers_needed = ceil((peak_read_qps + peak_write_qps) / rps_per_server)",
];

function build(title: string, assumptions: string[], extraAssumptions: string[], derivedExtra: string[]): string {
  return [`# ${title}`, ASSUME, ...assumptions, ...extraAssumptions, "", DERIVED, ...COMMON_DERIVED, ...derivedExtra].join("\n");
}

export const CALC_TEMPLATES: readonly CalcTemplate[] = [
  {
    id: "url-shortener", title: "URL shortener", blurb: "read-heavy; short keys, tiny records",
    text: build("URL shortener",
      COMMON_ASSUMPTIONS({ dau: "100M", writes: "0.1", ratio: "100", size: "500 * byte", retention: "365 * 5", peak: "3", hot: "20%", rps: "2000 / sec" }),
      [],
      ["keys_needed = writes_per_day * retention_days", "key_length_base62 = ceil(log10(keys_needed) / log10(62))"]),
  },
  {
    id: "chat", title: "Chat / messaging", blurb: "small messages, fan-out to recipients, long-lived connections",
    text: build("Chat / messaging",
      COMMON_ASSUMPTIONS({ dau: "50M", writes: "40", ratio: "2", size: "200 * byte", retention: "365 * 2", peak: "5", hot: "10%", rps: "5000 / sec" }),
      ["online_fraction = 20%", "connections_per_server = 100k"],
      ["concurrent_connections = dau * online_fraction", "gateway_servers = ceil(concurrent_connections / connections_per_server)"]),
  },
  {
    id: "news-feed", title: "News feed", blurb: "few posts, many reads, fan-out on write",
    text: build("News feed",
      COMMON_ASSUMPTIONS({ dau: "200M", writes: "0.2", ratio: "100", size: "1KB", retention: "365 * 3", peak: "3", hot: "20%", rps: "1000 / sec" }),
      ["avg_followers = 200", "feed_entry_size = 50 * byte"],
      ["feed_entries_per_day = writes_per_day * avg_followers", "feed_storage_per_day = feed_entries_per_day * feed_entry_size * replication_factor"]),
  },
  {
    id: "video", title: "Video upload / streaming", blurb: "big uploads, transcoding, egress dominated by viewing",
    text: build("Video upload / streaming",
      COMMON_ASSUMPTIONS({ dau: "50M", writes: "0.01", ratio: "500", size: "300MB", retention: "365 * 5", peak: "2", hot: "5%", rps: "500 / sec" }),
      ["transcode_size_multiplier = 2", "watch_seconds_per_view = 300 * sec", "stream_bitrate = 500KB / sec"],
      [
        "stored_per_day = storage_per_day * transcode_size_multiplier",
        "concurrent_streams_avg = reads_per_day * watch_seconds_per_view / day",
        "concurrent_streams_peak = concurrent_streams_avg * peak_factor",
        "video_egress_peak = concurrent_streams_peak * stream_bitrate",
        "cdn_hot_set = stored_per_day * 30 * hot_fraction",
      ]),
  },
  {
    id: "file-storage", title: "File storage / sync", blurb: "large objects, dedup, mostly cold",
    text: build("File storage / sync",
      COMMON_ASSUMPTIONS({ dau: "10M", writes: "5", ratio: "2", size: "500KB", retention: "365 * 3", peak: "3", hot: "5%", rps: "500 / sec" }),
      ["dedupe_savings = 30%"],
      ["storage_after_dedupe = storage_retained * (1 - dedupe_savings)"]),
  },
  {
    id: "crud", title: "Generic CRUD service", blurb: "a plain API over a database",
    text: build("Generic CRUD service",
      COMMON_ASSUMPTIONS({ dau: "1M", writes: "5", ratio: "9", size: "2KB", retention: "365 * 3", peak: "3", hot: "20%", rps: "500 / sec" }),
      [],
      ["total_requests_per_day = writes_per_day + reads_per_day"]),
  },
];
