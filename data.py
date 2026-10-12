"""Dane gry: rzadkości, skrzynki i karty.

To są DOMYŚLNE karty i skrzynki. Karty i skrzynki dodane/zmienione w panelu admina (/admin)
są zapisywane w bazie i nakładane na te dane (patrz catalog.py).
Pola osoby:
    id      - unikalny identyfikator (nie zmieniaj go, jeśli masz już takie karty w klaserze)
    name    - wyświetlana nazwa
    wiki    - (język wikipedii, tytuł artykułu) - stąd pobierane jest zdjęcie
    rarity  - green / blue / purple / red / gold / ultra / secret
    type    - kategoria (klucz z TYPES)
    hp      - punkty życia na karcie
    attack  - (nazwa ataku, obrażenia)
"""

STARTING_BALANCE = 20_000
CRATE_PRICE = 100
MAX_OPEN = 20

# Warianty kart: szansa na wariant przy każdym dropie i mnożnik wartości
VARIANTS = {
    "normal":  {"name": "Zwykła",       "chance": 0.0,   "mult": 1.0},
    "reverse": {"name": "Reverse Holo", "chance": 0.06,  "mult": 1.5},
    "holo":    {"name": "Holo",         "chance": 0.04,  "mult": 2.5},
    "alt":     {"name": "Alt Art",      "chance": 0.025, "mult": 3.0},
    "gold":    {"name": "Golden",       "chance": 0.01,  "mult": 6.0},
}
VARIANT_ORDER = list(VARIANTS)   # od najpospolitszego do najrzadszego

# Kuźnia - kontrakt: ile kart danej rzadkości daje 1 kartę rzadkości wyższej
CONTRACT_SIZE = {"green": 3, "blue": 3, "purple": 3, "red": 3, "gold": 4, "ultra": 5}
CONTRACT_VARIANT_BONUS = 0.5   # każda karta w specjalnym wariancie zwiększa szanse na wariant o 50%
# Kuźnia - ulepszacz: szansa = wartość wkładu / wartość celu * UPGRADE_EDGE (max UPGRADE_MAX)
UPGRADE_EDGE = 0.9
UPGRADE_MAX = 0.8
UPGRADE_MAX_ITEMS = 10
MAX_DEPOSIT = 1_000_000

# Skrzynki z pieniędzmi (codzienna nagroda za logowanie).
# Wylosowana kwota = min + (max - min) * los^curve  ->  im większe curve, tym rzadsze wysokie kwoty.
MONEY_CHESTS = {
    "daily": {"name": "Codzienna skrzynka", "emoji": "🎁", "min": 1_000, "max": 20_000, "curve": 2.2,
              "color1": "#3ddc84", "color2": "#0f5a32"},
    "mega":  {"name": "MEGA skrzynka", "emoji": "💎", "min": 5_000, "max": 50_000, "curve": 2.0,
              "color1": "#ffd54a", "color2": "#8a5b00"},
}
JACKPOT_WEEKDAY = 6       # w ten dzień tygodnia zamiast zwykłej jest MEGA skrzynka (0 = pon ... 6 = niedziela)
SHOWCASE_SIZE = 6         # ile kart mieści gablota na profilu

# kolejność = od najpospolitszej do najrzadszej
RARITIES = {
    "green":  {"name": "Zwykła",           "weight": 56.3, "value": 10,   "color": "#4fc34f"},
    "blue":   {"name": "Rzadka",           "weight": 25.0, "value": 30,   "color": "#4b8bff"},
    "purple": {"name": "Epicka",           "weight": 12.0, "value": 90,   "color": "#a35bff"},
    "red":    {"name": "Mityczna",         "weight": 5.5,  "value": 300,  "color": "#ff4040"},
    "gold":   {"name": "Legendarna",       "weight": 1.0,  "value": 1000, "color": "#ffc531"},
    "ultra":  {"name": "ULTRA LEGENDARNA", "weight": 0.2,  "value": 4000, "color": "#ff5cf0"},
    "secret": {"name": "TAJNA",            "weight": 0.0,  "value": 25000, "color": "#f3e3b0"},
}
RARITY_ORDER = list(RARITIES)

# Tajna karta wypada dokładnie 1 raz na SECRET_ODDS otwartych skrzynek
SECRET_ODDS = 2137
RARITIES["secret"]["weight"] = sum(r["weight"] for k, r in RARITIES.items() if k != "secret") / (SECRET_ODDS - 1)

TYPES = {
    "polityka": {"name": "Polityka",  "icon": "🏛️"},
    "sport":    {"name": "Sport",     "icon": "⚽"},
    "muzyka":   {"name": "Muzyka",    "icon": "🎤"},
    "tv":       {"name": "Telewizja", "icon": "📺"},
    "kino":     {"name": "Kino",      "icon": "🎬"},
    "biznes":   {"name": "Biznes",    "icon": "💼"},
    "kuchnia":  {"name": "Kuchnia",   "icon": "🍳"},
    "internet": {"name": "Internet",  "icon": "📱"},
    "nauka":    {"name": "Nauka",     "icon": "🔬"},
    "wiara":    {"name": "Wiara",     "icon": "✝️"},
}

# Słabość / odporność (jak w kartach Pokémon) - czysto dekoracyjne
MATCHUPS = {
    "polityka": ("internet", "tv"),
    "sport":    ("kuchnia", "polityka"),
    "muzyka":   ("internet", "sport"),
    "tv":       ("polityka", "kino"),
    "kino":     ("tv", "muzyka"),
    "biznes":   ("polityka", "internet"),
    "kuchnia":  ("tv", "sport"),
    "internet": ("biznes", "polityka"),
    "nauka":    ("polityka", "internet"),
    "wiara":    ("internet", "polityka"),
}
for _t, (_weak, _res) in MATCHUPS.items():
    TYPES[_t]["weak"] = _weak
    TYPES[_t]["resist"] = _res


def P(id, name, wiki, rarity, type, hp, attack, dmg):
    return {"id": id, "name": name, "wiki": wiki, "rarity": rarity, "type": type,
            "hp": hp, "attack": attack, "dmg": dmg}


PEOPLE_PL = [
    # TAJNA
    P("pl_secret", "Jan Paweł II", ("pl", "Jan Paweł II"), "secret", "wiara", 500, "Barka", 300),
    # ULTRA
    P("pl_lewandowski", "Robert Lewandowski", ("pl", "Robert Lewandowski"), "ultra", "sport", 300, "5 goli w 9 minut", 250),
    # GOLD
    P("pl_malysz", "Adam Małysz", ("pl", "Adam Małysz"), "gold", "sport", 200, "Małyszomania", 180),
    P("pl_walesa", "Lech Wałęsa", ("pl", "Lech Wałęsa"), "gold", "polityka", 210, "Skok przez płot", 170),
    # RED
    P("pl_swiatek", "Iga Świątek", ("pl", "Iga Świątek"), "red", "sport", 160, "Bajgiel 6:0", 140),
    P("pl_tusk", "Donald Tusk", ("pl", "Donald Tusk"), "red", "polityka", 150, "Powrót z Brukseli", 120),
    P("pl_kaczynski", "Jarosław Kaczyński", ("pl", "Jarosław Kaczyński"), "red", "polityka", 150, "Bez żadnego trybu", 130),
    # PURPLE
    P("pl_duda", "Andrzej Duda", ("pl", "Andrzej Duda"), "purple", "polityka", 120, "Długopis prezydencki", 100),
    P("pl_nawrocki", "Karol Nawrocki", ("pl", "Karol Nawrocki"), "purple", "polityka", 125, "Prawy prosty", 100),
    P("pl_stoch", "Kamil Stoch", ("pl", "Kamil Stoch"), "purple", "sport", 130, "Idealny telemark", 110),
    P("pl_doda", "Doda", ("pl", "Doda (piosenkarka)"), "purple", "muzyka", 115, "Nie daj się", 100),
    P("pl_maklowicz", "Robert Makłowicz", ("pl", "Robert Makłowicz"), "purple", "kuchnia", 120, "Ach, cóż za aromat", 90),
    P("pl_gessler", "Magda Gessler", ("pl", "Magda Gessler"), "purple", "kuchnia", 125, "Kuchenne rewolucje", 110),
    # BLUE
    P("pl_mentzen", "Sławomir Mentzen", ("pl", "Sławomir Mentzen"), "blue", "polityka", 90, "Piwo z wyborcami", 70),
    P("pl_trzaskowski", "Rafał Trzaskowski", ("pl", "Rafał Trzaskowski"), "blue", "polityka", 90, "Gówno w Wiśle", 70),
    P("pl_holownia", "Szymon Hołownia", ("pl", "Szymon Hołownia"), "blue", "polityka", 85, "Przywołanie do porządku", 70),
    P("pl_ibisz", "Krzysztof Ibisz", ("pl", "Krzysztof Ibisz"), "blue", "tv", 95, "Wieczna młodość", 60),
    P("pl_wojewodzki", "Kuba Wojewódzki", ("pl", "Kuba Wojewódzki"), "blue", "tv", 85, "Kąśliwe pytanie", 75),
    P("pl_kubica", "Robert Kubica", ("pl", "Robert Kubica"), "blue", "sport", 100, "Błyskawiczny pit stop", 80),
    P("pl_podsiadlo", "Dawid Podsiadło", ("pl", "Dawid Podsiadło"), "blue", "muzyka", 80, "Małomiasteczkowy", 70),
    P("pl_szczesny", "Wojciech Szczęsny", ("pl", "Wojciech Szczęsny"), "blue", "sport", 95, "Parada w okienko", 70),
    # GREEN
    P("pl_zenek", "Zenek Martyniuk", ("pl", "Zenon Martyniuk"), "green", "muzyka", 60, "Przez twe oczy zielone", 40),
    P("pl_rodowicz", "Maryla Rodowicz", ("pl", "Maryla Rodowicz"), "green", "muzyka", 55, "Małgośka", 40),
    P("pl_pudzianowski", "Mariusz Pudzianowski", ("pl", "Mariusz Pudzianowski"), "green", "sport", 70, "Rzut oponą", 50),
    P("pl_najman", "Marcin Najman", ("pl", "Marcin Najman"), "green", "sport", 50, "El Testosteron", 30),
    P("pl_korwin", "Janusz Korwin-Mikke", ("pl", "Janusz Korwin-Mikke"), "green", "polityka", 50, "Muszka bojowa", 40),
    P("pl_petru", "Ryszard Petru", ("pl", "Ryszard Petru"), "green", "polityka", 45, "Sześciu króli", 30),
    P("pl_sanah", "sanah", ("pl", "Sanah"), "green", "muzyka", 55, "Szampan", 40),
    P("pl_wojciechowska", "Martyna Wojciechowska", ("pl", "Martyna Wojciechowska"), "green", "tv", 65, "Kobieta na krańcu świata", 45),
    P("pl_wisniewski", "Michał Wiśniewski", ("pl", "Michał Wiśniewski"), "green", "muzyka", 55, "Czerwone włosy", 40),
    P("pl_quebonafide", "Quebonafide", ("pl", "Quebonafide"), "green", "muzyka", 60, "Bubbletea", 45),
    # --- dodane w wersji 2 ---
    P("pl_curie", "Maria Skłodowska-Curie", ("pl", "Maria Skłodowska-Curie"), "ultra", "nauka", 290, "Podwójny Nobel", 260),
    P("pl_pilsudski", "Józef Piłsudski", ("pl", "Józef Piłsudski"), "gold", "polityka", 215, "Wąsy Marszałka", 175),
    P("pl_krawczyk", "Krzysztof Krawczyk", ("pl", "Krzysztof Krawczyk"), "red", "muzyka", 155, "Parostatek", 135),
    P("pl_morawiecki", "Mateusz Morawiecki", ("pl", "Mateusz Morawiecki"), "red", "polityka", 150, "Polski Ład", 125),
    P("pl_zyla", "Piotr Żyła", ("pl", "Piotr Żyła"), "red", "sport", 145, "Śmiech na skoczni", 130),
    P("pl_hurkacz", "Hubert Hurkacz", ("pl", "Hubert Hurkacz"), "purple", "sport", 125, "As serwisowy", 105),
    P("pl_szydlo", "Beata Szydło", ("pl", "Beata Szydło"), "purple", "polityka", 115, "Po prostu się należało", 100),
    P("pl_bosak", "Krzysztof Bosak", ("pl", "Krzysztof Bosak"), "purple", "polityka", 120, "Spokojna riposta", 95),
    P("pl_gorniak", "Edyta Górniak", ("pl", "Edyta Górniak"), "purple", "muzyka", 120, "Hymn na mundialu", 100),
    P("pl_wlodarczyk", "Anita Włodarczyk", ("pl", "Anita Włodarczyk"), "blue", "sport", 100, "Rzut młotem", 85),
    P("pl_kowalczyk", "Justyna Kowalczyk", ("pl", "Justyna Kowalczyk"), "blue", "sport", 95, "Podbieg w Val di Fiemme", 80),
    P("pl_ziobro", "Zbigniew Ziobro", ("pl", "Zbigniew Ziobro"), "blue", "polityka", 85, "Zero tolerancji", 70),
    P("pl_czarnek", "Przemysław Czarnek", ("pl", "Przemysław Czarnek"), "blue", "polityka", 85, "Lex Czarnek", 70),
    P("pl_kazik", "Kazik Staszewski", ("pl", "Kazik Staszewski"), "blue", "muzyka", 90, "Twój ból jest lepszy niż mój", 75),
    P("pl_stanowski", "Krzysztof Stanowski", ("pl", "Krzysztof Stanowski (dziennikarz)"), "green", "internet", 60, "Kanał Zero", 45),
    P("pl_farna", "Ewa Farna", ("pl", "Ewa Farna"), "green", "muzyka", 55, "Ewakuacja", 40),
    P("pl_linda", "Bogusław Linda", ("pl", "Bogusław Linda"), "green", "kino", 65, "Psy", 50),
    P("pl_pazura", "Cezary Pazura", ("pl", "Cezary Pazura"), "green", "kino", 60, "Kiler", 45),
    P("pl_golota", "Andrzej Gołota", ("pl", "Andrzej Gołota"), "green", "sport", 70, "Cios poniżej pasa", 50),
    P("pl_kukiz", "Paweł Kukiz", ("pl", "Paweł Kukiz"), "green", "polityka", 55, "JOW-y", 40),
]

PEOPLE_WORLD = [
    # TAJNA
    P("w_secret", "Charlie Kirk", ("en", "Charlie Kirk"), "secret", "polityka", 500, "Prove Me Wrong", 300),
    # ULTRA
    P("w_trump", "Donald Trump", ("en", "Donald Trump"), "ultra", "polityka", 300, "Tweet o 3 w nocy", 250),
    # GOLD
    P("w_ronaldo", "Cristiano Ronaldo", ("en", "Cristiano Ronaldo"), "gold", "sport", 210, "SIUUU!", 190),
    P("w_messi", "Lionel Messi", ("en", "Lionel Messi"), "gold", "sport", 205, "Drybling przez pół boiska", 180),
    # RED
    P("w_musk", "Elon Musk", ("en", "Elon Musk"), "red", "biznes", 160, "Rakieta na Marsa", 140),
    P("w_obama", "Barack Obama", ("en", "Barack Obama"), "red", "polityka", 155, "Yes We Can", 130),
    P("w_swift", "Taylor Swift", ("en", "Taylor Swift"), "red", "muzyka", 150, "Eras Tour", 140),
    # PURPLE
    P("w_putin", "Władimir Putin", ("en", "Vladimir Putin"), "purple", "polityka", 120, "Bardzo długi stół", 100),
    P("w_biden", "Joe Biden", ("en", "Joe Biden"), "purple", "polityka", 110, "Lody czekoladowe", 90),
    P("w_kim", "Kim Dzong Un", ("en", "Kim Jong Un"), "purple", "polityka", 115, "Pokaz fajerwerków", 110),
    P("w_keanu", "Keanu Reeves", ("en", "Keanu Reeves"), "purple", "kino", 130, "You're breathtaking!", 110),
    P("w_beyonce", "Beyoncé", ("en", "Beyoncé"), "purple", "muzyka", 125, "Single Ladies", 100),
    P("w_lebron", "LeBron James", ("en", "LeBron James"), "purple", "sport", 130, "Wsad z linii rzutów", 110),
    # BLUE
    P("w_macron", "Emmanuel Macron", ("en", "Emmanuel Macron"), "blue", "polityka", 90, "Miażdżący uścisk dłoni", 70),
    P("w_merkel", "Angela Merkel", ("en", "Angela Merkel"), "blue", "polityka", 95, "Romb Merkel", 70),
    P("w_zelensky", "Wołodymyr Zełenski", ("en", "Volodymyr Zelenskyy"), "blue", "polityka", 100, "Potrzebuję amunicji", 80),
    P("w_rock", "Dwayne „The Rock” Johnson", ("en", "Dwayne Johnson"), "blue", "kino", 100, "Uniesiona brew", 80),
    P("w_rihanna", "Rihanna", ("en", "Rihanna"), "blue", "muzyka", 85, "Umbrella", 70),
    P("w_dicaprio", "Leonardo DiCaprio", ("en", "Leonardo DiCaprio"), "blue", "kino", 90, "Wreszcie Oscar", 75),
    P("w_zuckerberg", "Mark Zuckerberg", ("en", "Mark Zuckerberg"), "blue", "biznes", 80, "Senator, we run ads", 60),
    P("w_bolt", "Usain Bolt", ("en", "Usain Bolt"), "blue", "sport", 95, "Błyskawica", 85),
    # GREEN
    P("w_bieber", "Justin Bieber", ("en", "Justin Bieber"), "green", "muzyka", 55, "Baby, baby, baby", 40),
    P("w_kardashian", "Kim Kardashian", ("en", "Kim Kardashian"), "green", "tv", 55, "Selfie", 35),
    P("w_ramsay", "Gordon Ramsay", ("en", "Gordon Ramsay"), "green", "kuchnia", 70, "IT'S RAW!", 50),
    P("w_mrbeast", "MrBeast", ("en", "MrBeast"), "green", "internet", 65, "Rozdanie miliona $", 50),
    P("w_boris", "Boris Johnson", ("en", "Boris Johnson"), "green", "polityka", 60, "Fryzura na wietrze", 45),
    P("w_trudeau", "Justin Trudeau", ("en", "Justin Trudeau"), "green", "polityka", 55, "Kolorowe skarpetki", 40),
    P("w_gates", "Bill Gates", ("en", "Bill Gates"), "green", "biznes", 60, "Niebieski ekran", 45),
    P("w_bezos", "Jeff Bezos", ("en", "Jeff Bezos"), "green", "biznes", 60, "Dostawa w 24h", 45),
    P("w_shakira", "Shakira", ("en", "Shakira"), "green", "muzyka", 60, "Hips Don't Lie", 45),
    P("w_sheeran", "Ed Sheeran", ("en", "Ed Sheeran"), "green", "muzyka", 55, "Shape of You", 40),
    # --- dodane w wersji 2 ---
    P("w_einstein", "Albert Einstein", ("en", "Albert Einstein"), "ultra", "nauka", 290, "E = mc²", 260),
    P("w_jordan", "Michael Jordan", ("en", "Michael Jordan"), "gold", "sport", 210, "Air Jordan", 185),
    P("w_elizabeth", "Elżbieta II", ("en", "Elizabeth II"), "red", "polityka", 160, "Królewskie pozdrowienie", 130),
    P("w_mbappe", "Kylian Mbappé", ("en", "Kylian Mbappé"), "red", "sport", 150, "Turbo sprint", 140),
    P("w_arnold", "Arnold Schwarzenegger", ("en", "Arnold Schwarzenegger"), "red", "kino", 165, "I'll be back", 135),
    P("w_xi", "Xi Jinping", ("en", "Xi Jinping"), "purple", "polityka", 120, "Nowy Jedwabny Szlak", 100),
    P("w_cruise", "Tom Cruise", ("en", "Tom Cruise"), "purple", "kino", 125, "Mission: Impossible", 110),
    P("w_eminem", "Eminem", ("en", "Eminem"), "purple", "muzyka", 120, "Lose Yourself", 105),
    P("w_serena", "Serena Williams", ("en", "Serena Williams"), "purple", "sport", 130, "As serwisowy", 105),
    P("w_gaga", "Lady Gaga", ("en", "Lady Gaga"), "blue", "muzyka", 85, "Poker Face", 75),
    P("w_willsmith", "Will Smith", ("en", "Will Smith"), "blue", "kino", 95, "Policzek na gali", 80),
    P("w_depp", "Johnny Depp", ("en", "Johnny Depp"), "blue", "kino", 90, "Kapitan Jack Sparrow", 75),
    P("w_djokovic", "Novak Đoković", ("en", "Novak Djokovic"), "blue", "sport", 100, "Ściana na korcie", 80),
    P("w_greta", "Greta Thunberg", ("en", "Greta Thunberg"), "blue", "polityka", 80, "How dare you!", 70),
    P("w_snoop", "Snoop Dogg", ("en", "Snoop Dogg"), "green", "muzyka", 60, "Drop It Like It's Hot", 45),
    P("w_grylls", "Bear Grylls", ("en", "Bear Grylls"), "green", "tv", 70, "Szkoła przetrwania", 50),
    P("w_hilton", "Paris Hilton", ("en", "Paris Hilton"), "green", "tv", 50, "That's hot", 35),
    P("w_atkinson", "Rowan Atkinson", ("en", "Rowan Atkinson"), "green", "kino", 60, "Jaś Fasola", 45),
    P("w_norris", "Chuck Norris", ("en", "Chuck Norris"), "green", "kino", 70, "Kopniak z półobrotu", 50),
    P("w_chan", "Jackie Chan", ("en", "Jackie Chan"), "green", "kino", 65, "Kung-fu kaskader", 50),
]

CRATES = {
    "pl": {"name": "Skrzynka Polska", "short": "Polska", "code": "PL", "emoji": "🦅",
           "color1": "#ffffff", "color2": "#dc143c", "price": CRATE_PRICE,
           "desc": "polskie gwiazdy, politycy i sportowcy", "people": PEOPLE_PL},
    "world": {"name": "Skrzynka Świat", "short": "Świat", "code": "ŚW", "emoji": "🌍",
              "color1": "#3d7bff", "color2": "#0e2a7a", "price": CRATE_PRICE,
              "desc": "światowe gwiazdy i politycy", "people": PEOPLE_WORLD},
}


def card_value(person, variant="normal"):
    v = RARITIES[person["rarity"]]["value"]
    return int(round(v * VARIANTS.get(variant, VARIANTS["normal"])["mult"]))
