//! Silnik walki kartami (port arena.py). Przeglądarka wysyła tylko ruchy (wystaw kartę, użyj zdolności, wróć na
//! ławkę, koniec tury, poddanie), serwer sprawdza zasady, liczy skutki i zapisuje kolejne "kroki" walki - każdy krok
//! ma zdarzenia do animacji i stan planszy po ruchu. Strony w walce to "a" i "b"; gracz zawsze widzi siebie jako
//! "me", a rywala jako "ai".

use std::collections::HashSet;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::catalog::{ArenaEffectCfg, Catalog, Person};
use crate::data::g;
use crate::db::now;

pub const TURN_LIMIT: i64 = 80; // po tylu turach (obu graczy razem) remis
pub const PVP_TURN_SECONDS: f64 = 90.0; // czas na turę w pojedynku z graczem - potem tura kończy się sama
pub const PVP_AWAY_SECONDS: f64 = 120.0; // gracz bez kontaktu z serwerem tak długo przegrywa walkowerem
const OWN_TICK: &[&str] = &["stun", "boost", "weaken", "burn", "poison"]; // odliczane na końcu tury właściciela karty
const OPP_TICK: &[&str] = &["taunt", "shield"]; // odliczane na końcu tury rywala (chronią przed nim)

pub fn other(k: &str) -> &'static str {
    if k == "a" {
        "b"
    } else {
        "a"
    }
}

fn idx(k: &str) -> usize {
    (k == "b") as usize
}

/// Ruch niezgodny z zasadami - komunikat trafia do gracza
#[derive(Debug)]
pub struct ArenaError(pub String);

fn err<T>(msg: impl Into<String>) -> Result<T, ArenaError> {
    Err(ArenaError(msg.into()))
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub id: String,
    pub value: i64,
    pub turns: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unit {
    pub uid: i64,
    pub pid: String,
    pub variant: String,
    pub side: String,
    pub hp: i64,
    #[serde(rename = "maxHp")]
    pub max_hp: i64,
    pub st: Vec<Status>,
    pub acted: bool,
    #[serde(skip)]
    pub knock: bool,
}

impl Unit {
    fn has(&self, sid: &str) -> bool {
        self.st.iter().any(|x| x.id == sid)
    }

    fn st_val(&self, sid: &str) -> i64 {
        self.st.iter().filter(|x| x.id == sid).map(|x| x.value).sum()
    }

    fn add_status(&mut self, sid: &str, value: i64, turns: i64) {
        if let Some(old) = self.st.iter_mut().find(|x| x.id == sid) {
            old.value = old.value.max(value);
            old.turns = old.turns.max(turns);
        } else {
            self.st.push(Status { id: sid.into(), value, turns });
        }
    }

    /// Obrażenia: najpierw tarcza, potem HP. Zwraca obrażenia, które trafiły w HP.
    fn damage(&mut self, amount: f64, ev: &mut Vec<Value>, pierce: bool) -> i64 {
        let amount = (amount.round_ties_even() as i64).max(0);
        let mut left = amount;
        if !pierce {
            for s in self.st.iter_mut().filter(|x| x.id == "shield") {
                let take = s.value.min(left);
                s.value -= take;
                left -= take;
                if take != 0 {
                    ev.push(json!({"uid": self.uid, "kind": "block", "amount": take}));
                }
            }
        }
        self.st.retain(|x| !(x.id == "shield" && x.value <= 0));
        let hit = self.hp.min(left);
        self.hp -= hit;
        if left != 0 || amount == 0 {
            ev.push(json!({"uid": self.uid, "kind": "dmg", "amount": left}));
        }
        hit
    }

    fn heal(&mut self, amount: f64, ev: &mut Vec<Value>) {
        if self.has("poison") {
            ev.push(json!({"uid": self.uid, "kind": "text", "text": "☠️ nie leczy"}));
            return;
        }
        let h = (self.max_hp - self.hp).min(amount.round_ties_even() as i64);
        self.hp += h;
        ev.push(json!({"uid": self.uid, "kind": "heal", "amount": h}));
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Side {
    pub name: String,
    #[serde(skip)]
    pub user: Option<i64>,
    pub board: Vec<Unit>,
    pub bench: Vec<Unit>,
    pub ko: Vec<Unit>,
    pub coins: i64,
    #[serde(rename = "maxCoins")]
    pub max_coins: i64,
    pub actions: i64,
    #[serde(rename = "turnNo")]
    pub turn_no: i64,
    #[serde(rename = "coinPenalty")]
    pub coin_penalty: i64,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub sides: [Side; 2],
    pub active: String,
    pub first: String,
    pub turn: i64,
    pub over: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Step {
    pub data: Map<String, Value>,
    pub state: Snapshot,
}

/// Zdolność karty w walce (te same miejsca co w przeglądarce: 0, 1 = zdolności karty, 2+ = dodatkowe)
#[derive(Debug, Clone)]
pub struct Ab {
    pub kind: String,
    pub value: i64,
    pub cost: i64,
    pub target: String,
    pub effects: Vec<ArenaEffectCfg>,
}

pub fn card_cost(p: &Person) -> i64 {
    g().arena.card_cost.get(&p.rarity).copied().unwrap_or(1)
}

fn auto_cost(value: i64) -> i64 {
    let mut cost = 0;
    for (minimum, c) in &g().arena.ability_cost {
        if value >= *minimum {
            cost = *c;
        }
    }
    cost
}

pub fn abilities(p: &Person) -> Vec<Ab> {
    let mut raw: Vec<(usize, String, i64)> = vec![(0, p.kind1.clone(), p.dmg)];
    if p.attack2.is_some() {
        raw.push((1, p.kind2.clone(), p.dmg2));
    }
    for (i, a) in p.abilities.iter().enumerate() {
        raw.push((2 + i, a.kind.clone(), a.value));
    }
    raw.into_iter()
        .map(|(slot, kind, value)| {
            let c = p.arena.get(slot);
            Ab {
                cost: c.and_then(|c| c.cost).unwrap_or_else(|| auto_cost(value)),
                target: c.and_then(|c| c.target.clone()).unwrap_or_else(|| {
                    if kind == "off" {
                        "enemy".into()
                    } else {
                        "self".into()
                    }
                }),
                effects: c.map(|c| c.effects.clone()).unwrap_or_default(),
                kind,
                value,
            }
        })
        .collect()
}

fn needs_target(ab: &Ab) -> bool {
    ab.target == "enemy" || ab.target == "ally"
}

fn type_mult(cat: &Catalog, attacker: &Unit, target: &Unit, dmg: i64) -> (i64, &'static str) {
    let tt = g().types.get(&cat.people[&target.pid].type_);
    let at = &cat.people[&attacker.pid].type_;
    match tt {
        Some(t) if t.weak.as_ref() == Some(at) => (dmg * 2, "słabość ×2"),
        Some(t) if t.resist.as_ref() == Some(at) => ((dmg - 20).max(0), "odporność −20"),
        _ => (dmg, ""),
    }
}

fn new_side(cat: &Catalog, name: &str, user: Option<i64>, deck: &[DeckCard], key: &str, uid_start: i64) -> Side {
    let bench = deck
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let hp = cat.people[&c.pid].hp;
            Unit {
                uid: uid_start + i as i64,
                pid: c.pid.clone(),
                variant: c.variant.clone(),
                side: key.into(),
                hp,
                max_hp: hp,
                st: vec![],
                acted: false,
                knock: false,
            }
        })
        .collect();
    Side {
        name: name.into(),
        user,
        board: vec![],
        bench,
        ko: vec![],
        coins: 0,
        max_coins: 0,
        actions: 0,
        turn_no: 0,
        coin_penalty: 0,
    }
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct DeckCard {
    pub pid: String,
    pub variant: String,
}

/// Talia komputera: te same rzadkości co talia gracza, losowe osoby, wariant tylko dla wyglądu
pub fn ai_deck(cat: &Catalog, deck: &[DeckCard], allowed_secret: &HashSet<String>) -> Vec<DeckCard> {
    let g = g();
    let mut used: HashSet<String> = deck.iter().map(|c| c.pid.clone()).collect();
    let pool: Vec<&Person> = cat
        .people
        .values()
        .map(|p| p.as_ref())
        .filter(|p| p.hp > 0 && (!p.is_secret() || allowed_secret.contains(&p.id)))
        .collect();
    let looks: Vec<&String> = g.variant_order[1..].iter().filter(|v| !g.variants[*v].exclusive).collect(); // bez wyjątkowych
    let mut rng = rand::thread_rng();
    let mut out = vec![];
    for c in deck {
        let r = &cat.people[&c.pid].rarity;
        let mut opts: Vec<&&Person> = pool.iter().filter(|p| &p.rarity == r && !used.contains(&p.id)).collect();
        if opts.is_empty() {
            opts = pool.iter().filter(|p| !used.contains(&p.id)).collect();
        }
        let Some(p) = opts.choose(&mut rng).map(|p| **p).or_else(|| pool.first().copied()) else { break };
        used.insert(p.id.clone());
        let variant = if rng.gen::<f64>() < 0.7 {
            "normal".to_owned()
        } else {
            looks.choose(&mut rng).map(|v| (*v).clone()).unwrap_or_default()
        };
        out.push(DeckCard { pid: p.id.clone(), variant });
    }
    out
}

pub struct Player {
    pub name: String,
    pub user: Option<i64>,
    pub deck: Vec<DeckCard>,
    pub hero: Value,
}

pub struct Battle {
    pub id: String,
    pub mode: String, // "ai" (z komputerem) albo "pvp" (z innym graczem)
    pub sides: [Side; 2],
    pub heroes: [Value; 2],
    pub first: String,
    pub active: String,
    pub turn: i64,
    pub over: Option<String>, // None, "a", "b" albo "draw"
    pub reason: Option<String>,
    pub steps: Vec<Step>,
    pub auto: [bool; 2], // admin: komputer gra za gracza (wtedy bez nagród)
    pub no_reward: bool,
    pub rewards: [Option<Value>; 2], // nagroda strony (wpisuje arena_record po zakończeniu)
    pub recorded: bool,
    pub seen: [f64; 2],
    pub turn_started: f64,
    pub created: f64,
    pub touched: f64,
    pub finished_at: Option<f64>,
}

pub fn token() -> String {
    use base64::Engine;
    let bytes: [u8; 9] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

impl Battle {
    pub fn new(cat: &Catalog, mode: &str, a: Player, b: Player, first: &str) -> Battle {
        let now = now();
        Battle {
            id: token(),
            mode: mode.into(),
            sides: [new_side(cat, &a.name, a.user, &a.deck, "a", 1), new_side(cat, &b.name, b.user, &b.deck, "b", 101)],
            heroes: [a.hero, b.hero],
            first: first.into(),
            active: first.into(),
            turn: 0,
            over: None,
            reason: None,
            steps: vec![],
            auto: [false, false],
            no_reward: false,
            rewards: [None, None],
            recorded: false,
            seen: [now, now],
            turn_started: now,
            created: now,
            touched: now,
            finished_at: None,
        }
    }

    // ------------------------------------------------------------ pomocnicze

    fn side(&self, k: &str) -> &Side {
        &self.sides[idx(k)]
    }

    fn side_mut(&mut self, k: &str) -> &mut Side {
        &mut self.sides[idx(k)]
    }

    /// karty na planszy i na ławce
    fn alive(&self, k: &str) -> usize {
        self.side(k).board.len() + self.side(k).bench.len()
    }

    fn unit(&self, uid: i64) -> Option<&Unit> {
        self.sides.iter().flat_map(|s| s.board.iter().chain(&s.bench).chain(&s.ko)).find(|u| u.uid == uid)
    }

    fn unit_mut(&mut self, uid: i64) -> Option<&mut Unit> {
        self.sides
            .iter_mut()
            .flat_map(|s| s.board.iter_mut().chain(s.bench.iter_mut()).chain(s.ko.iter_mut()))
            .find(|u| u.uid == uid)
    }

    /// karta na planszy lub ławce (self.find z Pythona - bez pokonanych)
    fn find(&self, uid: i64) -> Option<&Unit> {
        self.sides.iter().flat_map(|s| s.board.iter().chain(&s.bench)).find(|u| u.uid == uid)
    }

    fn on_board(&self, k: &str, uid: i64) -> bool {
        self.side(k).board.iter().any(|u| u.uid == uid)
    }

    pub fn side_of_user(&self, user: i64) -> Option<&'static str> {
        ["a", "b"].into_iter().find(|k| self.side(k).user == Some(user))
    }

    pub fn user_of(&self, k: &str) -> Option<i64> {
        self.side(k).user
    }

    pub fn pids(&self) -> HashSet<String> {
        self.sides.iter().flat_map(|s| s.board.iter().chain(&s.bench).chain(&s.ko)).map(|u| u.pid.clone()).collect()
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            sides: self.sides.clone(),
            active: self.active.clone(),
            first: self.first.clone(),
            turn: self.turn,
            over: self.over.clone(),
            reason: self.reason.clone(),
        }
    }

    fn push(&mut self, kind: &str, side: Option<&str>, data: Value) {
        let mut m = data.as_object().cloned().unwrap_or_default();
        m.insert("n".into(), json!(self.steps.len() + 1));
        m.insert("type".into(), json!(kind));
        m.insert("side".into(), json!(side));
        let state = self.snapshot();
        self.steps.push(Step { data: m, state });
    }

    pub fn is_bot(&self, k: &str) -> bool {
        (self.mode == "ai" && k == "b") || self.auto[idx(k)]
    }

    pub fn set_auto(&mut self, k: &str, on: bool) {
        self.auto[idx(k)] = on;
        self.no_reward = self.no_reward || on;
    }

    pub fn auto_of(&self, k: &str) -> bool {
        self.auto[idx(k)]
    }

    pub fn touch_seen(&mut self, k: &str) {
        self.seen[idx(k)] = now();
    }

    pub fn reward(&self, k: &str) -> Option<&Value> {
        self.rewards[idx(k)].as_ref()
    }

    pub fn set_reward(&mut self, k: &str, v: Value) {
        self.rewards[idx(k)] = Some(v);
    }

    // ------------------------------------------------------------ zasady

    fn why_cant_act(&self, k: &str, u: &Unit) -> Option<String> {
        let s = self.side(k);
        if self.over.is_some() || self.active != k {
            return Some("To nie twoja tura".into());
        }
        if !self.on_board(k, u.uid) {
            return Some("Karta musi być na planszy".into());
        }
        if u.acted {
            return Some("Ta karta już działała w tej turze".into());
        }
        if u.has("stun") {
            return Some("Karta jest ogłuszona 💫".into());
        }
        if s.actions <= 0 {
            return Some("Brak akcji ⚡".into());
        }
        None
    }

    fn valid_targets(&self, k: &str, ab: &Ab) -> Vec<i64> {
        let foe = &self.side(other(k)).board;
        let own = &self.side(k).board;
        match ab.target.as_str() {
            "enemy" => {
                let taunt: Vec<i64> = foe.iter().filter(|t| t.has("taunt")).map(|t| t.uid).collect();
                if taunt.is_empty() {
                    foe.iter().map(|t| t.uid).collect()
                } else {
                    taunt
                }
            }
            "ally" => own.iter().map(|t| t.uid).collect(),
            _ => vec![],
        }
    }

    fn why_cant_use(&self, k: &str, u: &Unit, ab: &Ab) -> Option<String> {
        if let Some(why) = self.why_cant_act(k, u) {
            return Some(why);
        }
        if self.side(k).coins < ab.cost {
            return Some(format!("Za mało monet (potrzeba {} 🪙)", ab.cost));
        }
        if needs_target(ab) && self.valid_targets(k, ab).is_empty() {
            return Some("Brak celu".into());
        }
        None
    }

    fn primary(&self, k: &str, u: i64, ab: &Ab, target: Option<i64>) -> Vec<i64> {
        match ab.target.as_str() {
            "enemy" | "ally" => target.into_iter().collect(),
            "self" => vec![u],
            "all_enemies" => self.side(other(k)).board.iter().map(|t| t.uid).collect(),
            "all_allies" => self.side(k).board.iter().map(|t| t.uid).collect(),
            _ => vec![],
        }
    }

    fn resolve(&mut self, cat: &Catalog, k: &str, u: i64, ab: &Ab, primary: &[i64]) -> Vec<Value> {
        let mut ev = vec![];
        {
            let s = self.side_mut(k);
            s.coins -= ab.cost;
            s.actions -= 1;
        }
        if let Some(x) = self.unit_mut(u) {
            x.acted = true;
        }
        let mut dealt = 0;
        match ab.kind.as_str() {
            "off" => {
                for t in primary {
                    let (Some(att), Some(tu)) = (self.unit(u).cloned(), self.unit(*t).cloned()) else { continue };
                    let base = (ab.value + att.st_val("boost") - att.st_val("weaken")).max(0);
                    let (dmg, note) = type_mult(cat, &att, &tu, base);
                    if !note.is_empty() {
                        ev.push(json!({"uid": t, "kind": "text", "text": note}));
                    }
                    if let Some(x) = self.unit_mut(*t) {
                        dealt += x.damage(dmg as f64, &mut ev, false);
                    }
                }
            }
            "heal" => {
                // lecząca: wartość = leczone HP
                for t in primary {
                    if let Some(x) = self.unit_mut(*t) {
                        x.heal(ab.value as f64, &mut ev);
                    }
                }
            }
            "eco" => {
                // ekonomiczna: wartość = monety na tę turę (najwyżej limit monet)
                let s = self.side_mut(k);
                let gain = ab.value.min(g().arena.max_coins - s.coins).max(0);
                s.coins += gain;
                ev.push(json!({"uid": u, "kind": "text", "text": format!("🪙 +{gain}")}));
            }
            _ => {
                // defensywna: wartość = osłona
                for t in primary {
                    if let Some(x) = self.unit_mut(*t) {
                        x.add_status("shield", ab.value, 1);
                    }
                    ev.push(json!({"uid": t, "kind": "shield", "amount": ab.value}));
                }
            }
        }
        let mut rng = rand::thread_rng();
        for e in &ab.effects {
            let foe: Vec<i64> = self.side(other(k)).board.iter().map(|t| t.uid).collect();
            let own: Vec<i64> = self.side(k).board.iter().map(|t| t.uid).collect();
            let targets: Vec<i64> = match e.target.as_str() {
                "self" => vec![u],
                "all_allies" => own,
                "all_enemies" => foe.clone(),
                "random_enemy" => foe.choose(&mut rng).copied().into_iter().collect(),
                _ => primary.to_vec(),
            };
            let value = e.value;
            match e.id.as_str() {
                "heal" => {
                    for t in &targets {
                        if let Some(x) = self.unit_mut(*t) {
                            x.heal(value as f64, &mut ev);
                        }
                    }
                }
                "lifesteal" => {
                    if let Some(x) = self.unit_mut(u) {
                        x.heal(dealt as f64 * value as f64 / 100.0, &mut ev);
                    }
                }
                "splash" => {
                    for t in &targets {
                        let Some(side) = self.unit(*t).map(|x| x.side.clone()) else { continue };
                        let board: Vec<i64> = self.side(&side).board.iter().map(|x| x.uid).collect();
                        if let Some(i) = board.iter().position(|x| x == t) {
                            let neighbours = [i.checked_sub(1).map(|j| board[j]), board.get(i + 1).copied()];
                            for n in neighbours.into_iter().flatten() {
                                if let Some(x) = self.unit_mut(n) {
                                    x.damage(value as f64, &mut ev, false);
                                }
                            }
                        }
                    }
                }
                "steal_coins" => {
                    self.side_mut(other(k)).coin_penalty += value;
                    ev.push(json!({"uid": u, "kind": "text", "text": format!("💰 −{value} 🪙 rywalowi")}));
                }
                "extra_action" => {
                    let s = self.side_mut(k);
                    s.actions = (s.actions + value).min(5);
                    ev.push(json!({"uid": u, "kind": "text", "text": format!("⚡ +{value} akcja")}));
                }
                "knockback" => {
                    for t in &targets {
                        let Some(x) = self.unit(*t).cloned() else { continue };
                        if x.side != k && self.on_board(&x.side, x.uid) && x.hp > 0 {
                            ev.push(json!({"uid": t, "kind": "text", "text": "🔁 na ławkę!"}));
                            if let Some(x) = self.unit_mut(*t) {
                                x.knock = true;
                            }
                        }
                    }
                }
                other_id => {
                    let info = g().arena_effects.get(other_id);
                    let (icon, name) = info.map(|i| (i.icon.clone(), i.name.clone())).unwrap_or(("❔".into(), other_id.into()));
                    for t in &targets {
                        if let Some(x) = self.unit_mut(*t) {
                            x.add_status(other_id, value, if e.turns != 0 { e.turns } else { 1 });
                        }
                        ev.push(json!({"uid": t, "kind": "status", "text": format!("{icon} {name}")}));
                    }
                }
            }
        }
        ev
    }

    /// Karty bez HP schodzą z planszy (K.O.), odrzucone ("Do ławki!") wracają na ławkę
    fn collect_ko(&mut self) -> Vec<i64> {
        let mut kos = vec![];
        for s in self.sides.iter_mut() {
            let board = std::mem::take(&mut s.board);
            for mut u in board {
                let knock = std::mem::take(&mut u.knock);
                if u.hp <= 0 {
                    kos.push(u.uid);
                    s.ko.push(u);
                } else if knock {
                    s.bench.push(u);
                } else {
                    s.board.push(u);
                }
            }
        }
        kos
    }

    fn finish(&mut self, winner: &str, reason: &str) {
        if self.over.is_some() {
            return;
        }
        self.over = Some(winner.into());
        self.reason = Some(reason.into());
        self.finished_at = Some(now());
        self.push("over", None, json!({"winner": winner, "reason": reason}));
    }

    fn check_win(&mut self) -> bool {
        if self.over.is_some() {
            return true;
        }
        let (dead_a, dead_b) = (self.alive("a") == 0, self.alive("b") == 0);
        if dead_a && dead_b {
            self.finish("draw", "ko");
        } else if dead_a || dead_b {
            self.finish(if dead_a { "b" } else { "a" }, "ko");
        }
        self.over.is_some()
    }

    // ------------------------------------------------------------ tury

    pub fn start(&mut self, cat: &Catalog) {
        let first = self.first.clone();
        self.push("start", Some(&first), json!({}));
        self.start_turn(&first);
        self.run_bots(cat);
    }

    fn start_turn(&mut self, k: &str) {
        self.active = k.into();
        self.turn += 1;
        if self.turn > TURN_LIMIT {
            return self.finish("draw", "limit");
        }
        let first = self.first.clone();
        let rules = &g().arena;
        let bonus;
        {
            let s = self.side_mut(k);
            s.turn_no += 1;
            bonus = if s.turn_no == 1 && k != first { 1 } else { 0 }; // drugi gracz: +1 moneta na start
            s.max_coins = rules.max_coins.min(s.turn_no) + bonus;
            s.coins = (s.max_coins - s.coin_penalty).max(0);
            s.coin_penalty = 0;
            s.actions = rules.actions;
        }
        let mut ev = vec![];
        {
            let s = self.side_mut(k);
            for u in s.board.iter_mut() {
                u.acted = false;
                for sid in ["burn", "poison"] {
                    if u.has(sid) {
                        let v = u.st_val(sid);
                        u.damage(v as f64, &mut ev, true);
                    }
                }
            }
            for u in s.bench.iter_mut() {
                u.acted = false;
            }
        }
        let kos = self.collect_ko();
        self.turn_started = now();
        self.push("turn", Some(k), json!({"ev": ev, "kos": kos, "bonus": bonus}));
        self.check_win();
    }

    pub fn end_turn(&mut self, k: &str, timeout: bool) -> Result<(), ArenaError> {
        if self.over.is_some() || self.active != k {
            return err("To nie twoja tura");
        }
        fn tick(u: &mut Unit, ids: &[&str]) {
            for x in u.st.iter_mut() {
                if ids.contains(&x.id.as_str()) {
                    x.turns -= 1;
                }
            }
            u.st.retain(|x| x.turns > 0);
        }
        {
            let s = self.side_mut(k);
            for u in s.board.iter_mut().chain(s.bench.iter_mut()) {
                tick(u, OWN_TICK);
            }
        }
        {
            let s = self.side_mut(other(k));
            for u in s.board.iter_mut().chain(s.bench.iter_mut()) {
                tick(u, OPP_TICK);
            }
        }
        self.push("end", Some(k), json!({"timeout": timeout}));
        self.start_turn(other(k));
        Ok(())
    }

    // ------------------------------------------------------------ ruchy

    pub fn place(&mut self, cat: &Catalog, k: &str, uid: i64) -> Result<(), ArenaError> {
        let pos = self.side(k).bench.iter().position(|x| x.uid == uid);
        if self.over.is_some() || self.active != k {
            return err("To nie twoja tura");
        }
        let Some(pos) = pos else { return err("Tej karty nie ma na ławce") };
        let cost = card_cost(&cat.people[&self.side(k).bench[pos].pid]);
        if self.side(k).board.len() >= g().arena.board_slots {
            return err("Plansza jest pełna");
        }
        if self.side(k).coins < cost {
            return err(format!("Za mało monet ({cost} 🪙)"));
        }
        let s = self.side_mut(k);
        s.coins -= cost;
        let mut u = s.bench.remove(pos);
        u.acted = false;
        s.board.push(u);
        self.push("place", Some(k), json!({"uid": uid, "cost": cost}));
        Ok(())
    }

    pub fn retreat(&mut self, k: &str, uid: i64) -> Result<(), ArenaError> {
        let pos = self.side(k).board.iter().position(|x| x.uid == uid);
        if self.over.is_some() || self.active != k {
            return err("To nie twoja tura");
        }
        let Some(pos) = pos else { return err("Tej karty nie ma na planszy") };
        if self.side(k).actions <= 0 {
            return err("Brak akcji ⚡");
        }
        let s = self.side_mut(k);
        s.actions -= 1;
        let u = s.board.remove(pos);
        s.bench.push(u);
        self.push("retreat", Some(k), json!({"uid": uid}));
        Ok(())
    }

    pub fn use_ability(
        &mut self,
        cat: &Catalog,
        k: &str,
        uid: i64,
        ab_index: i64,
        target: Option<i64>,
    ) -> Result<(), ArenaError> {
        let Some(u) = self.side(k).board.iter().find(|x| x.uid == uid).cloned() else { return err("Karta musi być na planszy") };
        let abl = abilities(&cat.people[&u.pid]);
        if ab_index < 0 || ab_index as usize >= abl.len() {
            return err("Nie ma takiej zdolności");
        }
        let ab = &abl[ab_index as usize];
        if let Some(why) = self.why_cant_use(k, &u, ab) {
            return err(why);
        }
        let mut tgt = None;
        if needs_target(ab) {
            let found = target.and_then(|t| self.find(t)).map(|x| x.uid);
            if !found.is_some_and(|t| self.valid_targets(k, ab).contains(&t)) {
                return err("Ten cel jest niedostępny");
            }
            tgt = found;
        }
        let primary = self.primary(k, uid, ab, tgt);
        let ev = self.resolve(cat, k, uid, ab, &primary);
        let kos = self.collect_ko();
        self.push("use", Some(k), json!({"uid": uid, "ab": ab_index, "primary": primary, "ev": ev, "kos": kos}));
        self.check_win();
        Ok(())
    }

    pub fn surrender(&mut self, k: &str) {
        self.finish(other(k), "surrender");
    }

    // ------------------------------------------------------------ komputer

    fn ai_score(&self, cat: &Catalog, k: &str, u: &Unit, ab: &Ab, target: Option<i64>) -> f64 {
        let rules = &g().arena;
        let foe = self.side(other(k));
        let eff_bonus: f64 = ab.effects.iter().map(|e| 25.0 + e.value as f64 * 0.3).sum();
        let score: f64 = match ab.kind.as_str() {
            "off" => {
                let targets = self.primary(k, u.uid, ab, target);
                if targets.is_empty() {
                    return -1.0;
                }
                let mut score = 0.0;
                for t in targets {
                    let Some(t) = self.unit(t) else { continue };
                    let base = (ab.value + u.st_val("boost") - u.st_val("weaken")).max(0);
                    let dmg = (type_mult(cat, u, t, base).0 - t.st_val("shield")).max(0);
                    score += dmg.min(t.hp) as f64
                        + if dmg >= t.hp { 400.0 + card_cost(&cat.people[&t.pid]) as f64 * 40.0 } else { 0.0 };
                }
                score
            }
            "heal" => {
                let s: i64 = self
                    .primary(k, u.uid, ab, target)
                    .into_iter()
                    .filter_map(|t| self.unit(t))
                    .filter(|t| !t.has("poison"))
                    .map(|t| ab.value.min(t.max_hp - t.hp))
                    .sum();
                let s = s as f64 * 0.9;
                if s == 0.0 {
                    -1.0
                } else {
                    s
                }
            }
            "eco" => {
                let s = self.side(k);
                let want = s.bench.iter().any(|b| card_cost(&cat.people[&b.pid]) > s.coins) && s.board.len() < rules.board_slots;
                (ab.value.min(rules.max_coins - s.coins) * if want { 35 } else { 4 }) as f64
            }
            _ => {
                let hurt = self.side(k).board.iter().any(|x| (x.hp as f64) < x.max_hp as f64 * 0.5);
                let mut score = ab.value as f64 * if hurt { 0.8 } else { 0.25 };
                if foe.board.is_empty() {
                    score *= 0.3;
                }
                score
            }
        };
        score + eff_bonus - ab.cost as f64 * 15.0
    }

    fn place_all(&mut self, cat: &Catalog, k: &str) {
        // wystaw karty: najmocniejsze, na które stać
        while self.over.is_none() && self.active == k && self.side(k).board.len() < g().arena.board_slots {
            let coins = self.side(k).coins;
            let mut options: Vec<&Unit> = self.side(k).bench.iter().filter(|u| card_cost(&cat.people[&u.pid]) <= coins).collect();
            if options.is_empty() {
                break;
            }
            options.sort_by_key(|u| (-card_cost(&cat.people[&u.pid]), -cat.people[&u.pid].hp));
            let uid = options[0].uid;
            if self.place(cat, k, uid).is_err() {
                break;
            }
        }
    }

    fn ai_turn(&mut self, cat: &Catalog, k: &str) {
        // 1) wystaw karty
        self.place_all(cat, k);
        // 2) akcje: najlepsza zdolność albo ratowanie słabej karty (powrót na ławkę + wystawienie mocniejszej)
        while self.over.is_none() && self.active == k && self.side(k).actions > 0 {
            let mut best: Option<(f64, i64, usize, Option<i64>)> = None;
            for u in self.side(k).board.clone() {
                for (i, ab) in abilities(&cat.people[&u.pid]).iter().enumerate() {
                    if self.why_cant_use(k, &u, ab).is_some() {
                        continue;
                    }
                    let targets: Vec<Option<i64>> =
                        if needs_target(ab) { self.valid_targets(k, ab).into_iter().map(Some).collect() } else { vec![None] };
                    for t in targets {
                        let sc = self.ai_score(cat, k, &u, ab, t);
                        if best.as_ref().is_none_or(|b| sc > b.0) {
                            best = Some((sc, u.uid, i, t));
                        }
                    }
                }
            }
            let s = self.side(k);
            let weak = s.board.iter().find(|u| (u.hp as f64) < u.max_hp as f64 * 0.3 && !u.acted).map(|u| (u.uid, u.hp));
            let fresh = s
                .bench
                .iter()
                .filter(|u| card_cost(&cat.people[&u.pid]) <= s.coins)
                .fold(None::<&Unit>, |acc, u| if acc.is_none_or(|a| u.hp > a.hp) { Some(u) } else { acc })
                .map(|u| (u.uid, u.hp));
            match (weak, fresh) {
                (Some((wu, whp)), Some((fu, fhp))) if fhp > whp * 2 && best.as_ref().is_none_or(|b| b.0 < 120.0) => {
                    if self.retreat(k, wu).is_err() || self.place(cat, k, fu).is_err() {
                        break;
                    }
                }
                _ => match best {
                    Some((sc, uid, i, t)) if sc > 0.0 => {
                        if self.use_ability(cat, k, uid, i as i64, t).is_err() {
                            break;
                        }
                        self.place_all(cat, k); // zdolność ekonomiczna mogła dać monety na kolejną kartę
                    }
                    _ => break,
                },
            }
        }
        if self.over.is_none() && self.active == k {
            let _ = self.end_turn(k, false);
        }
    }

    /// Tury komputera (i gracza z włączoną auto-grą) liczą się od razu - przeglądarka pokaże je po kolei
    pub fn run_bots(&mut self, cat: &Catalog) {
        while self.over.is_none() && self.is_bot(&self.active.clone()) {
            let k = self.active.clone();
            self.ai_turn(cat, &k);
        }
    }

    // ------------------------------------------------------------ czas (pojedynki)

    /// Przy każdym zapytaniu: koniec czasu tury, walkower za brak kontaktu
    pub fn tick(&mut self, cat: &Catalog) {
        let now = now();
        self.touched = now;
        if self.over.is_some() || self.mode != "pvp" {
            return;
        }
        for k in ["a", "b"] {
            if now - self.seen[idx(k)] > PVP_AWAY_SECONDS {
                return self.finish(other(k), "away");
            }
        }
        if now - self.turn_started > PVP_TURN_SECONDS {
            let k = self.active.clone();
            let _ = self.end_turn(&k, true);
            self.run_bots(cat);
        }
    }

    fn turn_left(&self) -> Option<i64> {
        if self.over.is_some() || self.mode != "pvp" {
            return None;
        }
        Some(((PVP_TURN_SECONDS - (now() - self.turn_started)).round_ties_even() as i64).max(0))
    }

    // ------------------------------------------------------------ widok dla gracza

    /// Stan z perspektywy gracza: on = "me", rywal = "ai"; karty na ręce rywala są zakryte
    fn view_state(state: &Snapshot, me: &str) -> Value {
        let name = |k: &str| if k == me { "me" } else { "ai" };
        let mut sides = Map::new();
        for (i, s) in state.sides.iter().enumerate() {
            let k = if i == 0 { "a" } else { "b" };
            let vk = name(k);
            let conv = |u: &Unit| {
                let mut v = serde_json::to_value(u).unwrap_or_default();
                v["side"] = json!(vk);
                v
            };
            let mut v = serde_json::to_value(s).unwrap_or_default();
            v["board"] = json!(s.board.iter().map(conv).collect::<Vec<_>>());
            v["ko"] = json!(s.ko.iter().map(conv).collect::<Vec<_>>());
            v["bench"] = json!(s
                .bench
                .iter()
                .map(|u| if k == me { conv(u) } else { json!({"uid": u.uid, "side": vk, "hidden": true}) })
                .collect::<Vec<_>>());
            sides.insert(vk.into(), v);
        }
        let over = state.over.as_deref().map(|o| if o == "a" || o == "b" { name(o) } else { o });
        json!({"active": name(&state.active), "first": name(&state.first), "turn": state.turn, "over": over,
               "reason": state.reason, "sides": sides})
    }

    fn view_step(step: &Step, me: &str) -> Value {
        let name = |k: &str| if k == me { "me" } else { "ai" };
        let mut v = step.data.clone();
        let side = step.data.get("side").and_then(Value::as_str).map(name);
        v.insert("side".into(), json!(side));
        if let Some(w) = step.data.get("winner").and_then(Value::as_str) {
            v.insert("winner".into(), json!(if w == "a" || w == "b" { name(w) } else { w }));
        }
        v.insert("state".into(), Self::view_state(&step.state, me));
        Value::Object(v)
    }

    pub fn view(&self, me: &str, since: usize) -> Value {
        let name = |k: &str| if k == me { "me" } else { "ai" };
        let steps: Vec<Value> = self.steps.iter().skip(since).map(|s| Self::view_step(s, me)).collect();
        json!({"id": self.id, "mode": self.mode, "seen": self.steps.len(), "steps": steps,
               "state": Self::view_state(&self.snapshot(), me),
               "heroes": {name("a"): self.heroes[0], name("b"): self.heroes[1]},
               "turnLeft": self.turn_left(), "auto": self.auto[idx(me)], "rewards": self.rewards[idx(me)]})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bots_finish_a_battle() {
        let cat = crate::catalog::build(&[], &[]);
        let deck: Vec<DeckCard> = cat
            .people
            .values()
            .filter(|p| p.hp > 0 && !p.is_secret())
            .take(8)
            .map(|p| DeckCard { pid: p.id.clone(), variant: "normal".into() })
            .collect();
        let ai = ai_deck(&cat, &deck, &HashSet::new());
        assert_eq!(ai.len(), 8);
        let me = Player { name: "Ja".into(), user: Some(1), deck, hero: json!({"username": "Ja"}) };
        let bot = Player { name: "Komputer".into(), user: None, deck: ai, hero: json!({"username": "Komputer", "bot": true}) };
        let mut b = Battle::new(&cat, "ai", me, bot, "a");
        b.start(&cat);
        b.set_auto("a", true); // komputer gra za gracza - walka musi się skończyć
        b.run_bots(&cat);
        assert!(b.over.is_some(), "walka bez końca");
        let v = b.view("a", 0);
        assert!(v["state"]["over"].as_str().is_some());
        assert!(v["steps"].as_array().unwrap().len() > 2);
    }
}
