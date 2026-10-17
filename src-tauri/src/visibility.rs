use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    Visible,
    Hidden,
    Paused,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Blocker {
    Fullscreen,
    Locked,
    Suspended,
}

/// User intent survives temporary system suppression. Pausing also remembers a
/// previously hidden island, so resuming cannot unexpectedly reveal it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VisibilityPolicy {
    intent: Intent,
    resume_intent: Intent,
    blockers: BTreeSet<Blocker>,
}

impl Default for VisibilityPolicy {
    fn default() -> Self {
        Self {
            intent: Intent::Visible,
            resume_intent: Intent::Visible,
            blockers: BTreeSet::new(),
        }
    }
}

impl VisibilityPolicy {
    pub fn visible(&self) -> bool {
        self.intent == Intent::Visible && self.blockers.is_empty()
    }

    pub fn paused(&self) -> bool {
        self.intent == Intent::Paused
    }

    pub fn show(&mut self) {
        self.intent = Intent::Visible;
        self.resume_intent = Intent::Visible;
    }

    pub fn hide(&mut self) {
        self.intent = Intent::Hidden;
        self.resume_intent = Intent::Hidden;
    }

    pub fn toggle_pause(&mut self) {
        if self.paused() {
            self.intent = self.resume_intent;
        } else {
            self.resume_intent = self.intent;
            self.intent = Intent::Paused;
        }
    }

    pub fn set_blocker(&mut self, blocker: Blocker, active: bool) {
        if active {
            self.blockers.insert(blocker);
        } else {
            self.blockers.remove(&blocker);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fullscreen_restores_visible_intent_without_unhiding_a_user_hidden_island() {
        let mut policy = VisibilityPolicy::default();
        assert!(policy.visible());
        policy.set_blocker(Blocker::Fullscreen, true);
        assert!(!policy.visible());
        policy.set_blocker(Blocker::Fullscreen, false);
        assert!(policy.visible());
        policy.hide();
        policy.set_blocker(Blocker::Fullscreen, true);
        policy.set_blocker(Blocker::Fullscreen, false);
        assert!(!policy.visible());
        assert_eq!(policy.intent, Intent::Hidden);
    }

    #[test]
    fn show_requests_cannot_override_system_blockers() {
        let mut policy = VisibilityPolicy::default();
        policy.hide();
        policy.set_blocker(Blocker::Fullscreen, true);
        policy.show();
        assert!(!policy.visible());
        policy.set_blocker(Blocker::Fullscreen, false);
        assert!(policy.visible());
    }

    #[test]
    fn multiple_system_blockers_are_independent_and_idempotent() {
        let mut policy = VisibilityPolicy::default();
        for blocker in [Blocker::Fullscreen, Blocker::Locked, Blocker::Suspended] {
            policy.set_blocker(blocker, true);
            policy.set_blocker(blocker, true);
        }
        assert_eq!(policy.blockers.len(), 3);
        policy.set_blocker(Blocker::Fullscreen, false);
        policy.set_blocker(Blocker::Fullscreen, false);
        assert!(!policy.visible());
        policy.set_blocker(Blocker::Locked, false);
        assert!(!policy.visible());
        policy.set_blocker(Blocker::Suspended, false);
        assert!(policy.visible());
    }

    #[test]
    fn pause_and_resume_preserve_hidden_intent_and_survive_fullscreen_changes() {
        let mut policy = VisibilityPolicy::default();
        policy.toggle_pause();
        assert!(policy.paused());
        policy.set_blocker(Blocker::Fullscreen, true);
        policy.set_blocker(Blocker::Fullscreen, false);
        assert!(!policy.visible());
        policy.toggle_pause();
        assert!(policy.visible());
        policy.hide();
        policy.toggle_pause();
        policy.toggle_pause();
        assert!(!policy.visible());
        assert_eq!(policy.intent, Intent::Hidden);
    }

    #[test]
    fn explicit_show_or_hide_replaces_a_previous_pause() {
        let mut policy = VisibilityPolicy::default();
        policy.toggle_pause();
        policy.show();
        assert!(!policy.paused());
        assert!(policy.visible());
        policy.toggle_pause();
        policy.hide();
        assert!(!policy.paused());
        assert!(!policy.visible());
    }
}
