// How your PC feels, for Tokkip on Inicio: a score from 0 to 100, his mood,
// and the reasons behind it, each with the next step.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub score: u32,
    /// "happy", "calm", "tired" or "dizzy" (the moods Tokkip PC knows).
    pub mood: &'static str,
    pub disk_total: u64,
    pub disk_free: u64,
    pub last_clean: u64,
    pub last_freed: u64,
    pub total_freed: u64,
    pub elevated: bool,
    pub reasons: Vec<Reason>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    /// "disk", "clean".
    pub id: &'static str,
    /// "ok", "warn" or "bad".
    pub level: &'static str,
}

const DAY: u64 = 24 * 3600 * 1000;

pub fn assess(disk_total: u64, disk_free: u64, last_clean: u64, now: u64) -> (u32, &'static str, Vec<Reason>) {
    let mut score: i32 = 100;
    let mut reasons = Vec::new();

    let free = if disk_total > 0 { disk_free as f64 / disk_total as f64 } else { 1.0 };
    let disk = if free < 0.10 { score -= 40; "bad" } else if free < 0.20 { score -= 20; "warn" } else { "ok" };
    reasons.push(Reason { id: "disk", level: disk });

    let days = if last_clean == 0 { u64::MAX } else { now.saturating_sub(last_clean) / DAY };
    let clean = if days > 30 { score -= 20; "bad" } else if days > 14 { score -= 10; "warn" } else { "ok" };
    reasons.push(Reason { id: "clean", level: clean });

    let score = score.clamp(0, 100) as u32;
    let mood = match score {
        85.. => "happy",
        65..=84 => "calm",
        45..=64 => "tired",
        _ => "dizzy",
    };
    (score, mood, reasons)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plenty_of_space_and_a_recent_clean_is_happy() {
        let now = 100 * DAY;
        let (score, mood, reasons) = assess(1000, 500, now - 3 * DAY, now);
        assert_eq!((score, mood), (100, "happy"));
        assert!(reasons.iter().all(|r| r.level == "ok"));
    }

    #[test]
    fn a_full_disk_and_no_clean_ever_makes_him_dizzy() {
        let (score, mood, reasons) = assess(1000, 50, 0, 100 * DAY);
        assert_eq!((score, mood), (40, "dizzy"));
        assert_eq!(reasons[0].level, "bad");
        assert_eq!(reasons[1].level, "bad");
        let (score, mood, _) = assess(1000, 150, 80 * DAY, 100 * DAY);
        assert_eq!((score, mood), (70, "calm"));
    }
}
