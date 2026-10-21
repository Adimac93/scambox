//! Walka z perspektywy gracza: on = "me", rywal = "ai"; karty na ławce rywala są zakryte.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde::Serialize;

use super::engine::{Action, Battle, EndReason, Mode, Outcome, Side, Snapshot, Step, Team, Unit};
use super::{Hero, Reward};

fn label(me: Side, s: Side) -> &'static str {
    if s == me {
        "me"
    } else {
        "ai"
    }
}

fn outcome_label(me: Side, o: Outcome) -> &'static str {
    match o {
        Outcome::Won(s) => label(me, s),
        Outcome::Draw => "draw",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BattleView<'a> {
    id: &'a str,
    mode: Mode,
    /// liczba kroków walki (przeglądarka pyta potem o kolejne: ?since=)
    seen: usize,
    steps: Vec<StepView<'a>>,
    state: StateView<'a>,
    heroes: IndexMap<&'static str, &'a Hero>,
    turn_left: Option<i64>,
    auto: bool,
    rewards: Option<&'a Reward>,
}

#[derive(Serialize)]
struct StepView<'a> {
    n: usize,
    #[serde(flatten)]
    action: &'a Action,
    side: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    winner: Option<&'static str>,
    state: StateView<'a>,
}

#[derive(Serialize)]
struct StateView<'a> {
    active: &'static str,
    first: &'static str,
    turn: i64,
    over: Option<&'static str>,
    reason: Option<EndReason>,
    sides: IndexMap<&'static str, TeamView<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamView<'a> {
    name: &'a str,
    board: Vec<UnitView<'a>>,
    bench: Vec<BenchView<'a>>,
    ko: Vec<UnitView<'a>>,
    coins: i64,
    max_coins: i64,
    actions: i64,
    turn_no: i64,
    coin_penalty: i64,
}

#[derive(Serialize)]
struct UnitView<'a> {
    #[serde(flatten)]
    unit: &'a Unit,
    side: &'static str,
}

#[derive(Serialize)]
#[serde(untagged)]
enum BenchView<'a> {
    Shown(UnitView<'a>),
    Hidden { uid: i64, side: &'static str, hidden: bool },
}

impl<'a> StateView<'a> {
    fn new(s: &'a Snapshot, me: Side) -> Self {
        Self::of(&s.teams, (s.active, s.first, s.turn, s.over, s.reason), me)
    }

    /// stan z drużyn i (aktywna strona, pierwsza strona, tura, wynik, powód końca)
    fn of(
        teams: &'a [Team; 2],
        (active, first, turn, over, reason): (Side, Side, i64, Option<Outcome>, Option<EndReason>),
        me: Side,
    ) -> Self {
        let team =
            |t: &'a Team, k: Side| {
                let side = label(me, k);
                let shown = |u: &'a Unit| UnitView { unit: u, side };
                TeamView {
                    name: &t.name,
                    board: t.board.iter().map(shown).collect(),
                    bench: t
                        .bench
                        .iter()
                        .map(|u| {
                            if k == me {
                                BenchView::Shown(shown(u))
                            } else {
                                BenchView::Hidden { uid: u.uid, side, hidden: true }
                            }
                        })
                        .collect(),
                    ko: t.ko.iter().map(shown).collect(),
                    coins: t.coins,
                    max_coins: t.max_coins,
                    actions: t.actions,
                    turn_no: t.turn_no,
                    coin_penalty: t.coin_penalty,
                }
            };
        StateView {
            active: label(me, active),
            first: label(me, first),
            turn,
            over: over.map(|o| outcome_label(me, o)),
            reason,
            sides: Side::BOTH.iter().zip(teams).map(|(k, t)| (label(me, *k), team(t, *k))).collect(),
        }
    }
}

impl<'a> StepView<'a> {
    fn new(step: &'a Step, me: Side) -> Self {
        StepView {
            n: step.n,
            action: &step.action,
            side: step.side.map(|s| label(me, s)),
            winner: step.winner.map(|o| outcome_label(me, o)),
            state: StateView::new(&step.state, me),
        }
    }
}

/// Karty widoczne dla gracza: wszystkie moje, rywala - na planszy i pokonane
fn visible_pids<'a>(teams: &'a [Team; 2], me: Side, out: &mut HashSet<&'a str>) {
    for (k, t) in Side::BOTH.iter().zip(teams) {
        let bench = if *k == me { t.bench.as_slice() } else { &[] };
        out.extend(t.board.iter().chain(bench).chain(&t.ko).map(|u| u.pid.as_str()));
    }
}

impl Battle {
    /// Walka dla gracza `me`: kroki od `since` (wcześniejsze przeglądarka już pokazała) i aktualny stan
    pub fn view(&self, me: Side, since: usize) -> BattleView<'_> {
        BattleView {
            id: &self.id,
            mode: self.mode,
            seen: self.steps.len(),
            steps: self.steps.iter().skip(since).map(|s| StepView::new(s, me)).collect(),
            state: StateView::of(&self.teams, (self.active, self.first, self.turn, self.over, self.reason), me),
            heroes: Side::BOTH.into_iter().map(|k| (label(me, k), self.hero(k))).collect(),
            turn_left: self.turn_left(),
            auto: self.auto_of(me),
            rewards: self.reward(me),
        }
    }

    /// Karty, które gracz widzi w krokach od `since` i w aktualnym stanie (do pokazania tajnych kart)
    pub fn visible_pids(&self, me: Side, since: usize) -> HashSet<String> {
        let mut out = HashSet::new();
        for s in self.steps.iter().skip(since) {
            visible_pids(&s.state.teams, me, &mut out);
        }
        visible_pids(&self.teams, me, &mut out);
        out.into_iter().map(str::to_owned).collect()
    }
}
