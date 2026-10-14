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
    "bw":      {"name": "Czarno-biała", "chance": 0.05,  "mult": 1.5},
    "reverse": {"name": "Reverse Holo", "chance": 0.05,  "mult": 1.8},
    "silver":  {"name": "Srebrna",      "chance": 0.03,  "mult": 2.5},
    "holo":    {"name": "Holo",         "chance": 0.025, "mult": 3.0},
    "gold":    {"name": "Złota",        "chance": 0.01,  "mult": 7.5},
    # wyjątkowy: tylko ze skrzynek z tym wariantem, karta musi mieć ustawiony kraj (pole "country")
    "flag":    {"name": "Flagowa",      "chance": 0.008, "mult": 8.0, "exclusive": True,
                "desc": "Karta w barwach flagi swojego kraju. Każda karta w skrzynce potrzebuje ustawionego kraju (np. PL)."},
    "clear":   {"name": "Przezroczysta", "chance": 0.006, "mult": 9.0},
    "emerald": {"name": "Szmaragdowa",  "chance": 0.005, "mult": 11.0},
    "ruby":    {"name": "Rubinowa",     "chance": 0.004, "mult": 14.0},
    "royal":   {"name": "Królewska",    "chance": 0.004, "mult": 15.0, "exclusive": True,   # wyjątkowy (Skrzynia Królów)
                "desc": "Złota rama z klejnotami na krawędziach i korona na górze."},
    "diamond": {"name": "Diamentowa",   "chance": 0.003, "mult": 18.0},
    "negative": {"name": "Negatyw",     "chance": 0.001, "mult": 30.0},   # najrzadszy
}
VARIANT_ORDER = list(VARIANTS)   # od najpospolitszego do najrzadszego
# Warianty wyjątkowe ("exclusive"): wypadają TYLKO ze skrzynek, w których admin je włączył (pole skrzynki "variants"),
# nie da się ich dostać z kontraktu ani z ulepszacza.
EXCLUSIVE_VARIANTS = [v for v, x in VARIANTS.items() if x.get("exclusive")]
# domyślne warianty wyjątkowe skrzynek - dopóki admin nie zapisze w panelu własnego wyboru
DEFAULT_CRATE_VARIANTS = {"skrzynia_krolow": ["royal"]}

# Kuźnia - kontrakt: ile kart danej rzadkości daje 1 kartę rzadkości wyższej
# Liczby dobrane tak, żeby kontrakt NIE dawał zysku: średnio zwraca 81-87% wartości włożonych kart (jak ulepszacz <= 90%).
# Wcześniej (3 karty, bonus 50%) zwracał 146-162% - dało się zarabiać bez końca: skrzynki -> kontrakty -> sprzedaż.
# Przy zmianie wartości rzadkości / wariantów trzeba to przeliczyć.
CONTRACT_SIZE = {"green": 5, "blue": 5, "purple": 6, "red": 6, "gold": 7}   # tajnych kart nie da się wytworzyć
CONTRACT_VARIANT_BONUS = 0.1   # każda karta w specjalnym wariancie zwiększa szanse na wariant o 10%
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
    "artysta":  {"name": "Artysta",   "icon": "🎨"},
    "wojsko":   {"name": "Wojsko",    "icon": "🪖"},
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
    "artysta":  ("biznes", "internet"),
    "wojsko":   ("polityka", "sport"),
}

# Zdolności kart: każda jest ofensywna (atak, wartość = obrażenia) albo defensywna (obrona, wartość = osłona).
# Pierwsze dwie to pola attack/dmg i attack2/dmg2 (rodzaj: kind1/kind2, domyślnie ofensywna),
# kolejne admin dodaje w panelu jako listę "abilities".
ABILITY_KINDS = {"off": {"name": "Ofensywna", "icon": "⚔️"}, "def": {"name": "Defensywna", "icon": "🛡️"}}
MAX_EXTRA_ABILITIES = 2
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

PEOPLE_PRL = [
    # ULTRA
    P("prl_gierek", "Edward Gierek", ("pl", "Edward Gierek"), "ultra", "polityka", 290, "Pomożecie?", 250),
    # LEGENDARNE
    P("prl_hermaszewski", "Mirosław Hermaszewski", ("pl", "Mirosław Hermaszewski"), "gold", "nauka", 205, "Lot w kosmos", 180),
    P("prl_jaruzelski", "Wojciech Jaruzelski", ("pl", "Wojciech Jaruzelski"), "gold", "polityka", 205, "Przemówienie 13 grudnia", 180),
    # MITYCZNE
    P("prl_gomulka", "Władysław Gomułka", ("pl", "Władysław Gomułka"), "red", "polityka", 150, "Odwilż '56", 125),
    P("prl_urban", "Jerzy Urban", ("pl", "Jerzy Urban"), "red", "tv", 145, "Konferencja prasowa", 130),
    P("prl_bierut", "Bolesław Bierut", ("pl", "Bolesław Bierut"), "red", "polityka", 150, "Plan sześcioletni", 120),
    # EPICKIE
    P("prl_kiszczak", "Czesław Kiszczak", ("pl", "Czesław Kiszczak"), "purple", "polityka", 120, "Rozmowy w Magdalence", 100),
    P("prl_rakowski", "Mieczysław Rakowski", ("pl", "Mieczysław Rakowski"), "purple", "polityka", 115, "Ostatni premier PRL", 95),
    P("prl_walentynowicz", "Anna Walentynowicz", ("pl", "Anna Walentynowicz"), "purple", "polityka", 120, "Strajk w Stoczni", 105),
    P("prl_kuron", "Jacek Kuroń", ("pl", "Jacek Kuroń"), "purple", "polityka", 115, "Zupa Kuronia", 100),
    P("prl_bareja", "Stanisław Bareja", ("pl", "Stanisław Bareja"), "purple", "kino", 120, "Miś", 105),
    P("prl_deyna", "Kazimierz Deyna", ("pl", "Kazimierz Deyna"), "purple", "sport", 125, "Złoto w Monachium", 110),
    # RZADKIE
    P("prl_michnik", "Adam Michnik", ("pl", "Adam Michnik"), "blue", "polityka", 90, "Gazeta Wyborcza", 75),
    P("prl_boniek", "Zbigniew Boniek", ("pl", "Zbigniew Boniek"), "blue", "sport", 95, "Hat-trick z Belgią", 80),
    P("prl_szewinska", "Irena Szewińska", ("pl", "Irena Szewińska"), "blue", "sport", 95, "Rekord na 400 m", 80),
    P("prl_gorski", "Kazimierz Górski", ("pl", "Kazimierz Górski"), "blue", "sport", 90, "Orły Górskiego", 75),
    P("prl_niemen", "Czesław Niemen", ("pl", "Czesław Niemen"), "blue", "muzyka", 90, "Dziwny jest ten świat", 75),
    P("prl_cyrankiewicz", "Józef Cyrankiewicz", ("pl", "Józef Cyrankiewicz"), "blue", "polityka", 85, "Wieczny premier", 70),
    # ZWYKŁE
    P("prl_kozakiewicz", "Władysław Kozakiewicz", ("pl", "Władysław Kozakiewicz"), "green", "sport", 65, "Gest Kozakiewicza", 50),
    P("prl_tomaszewski", "Jan Tomaszewski", ("pl", "Jan Tomaszewski (piłkarz)"), "green", "sport", 70, "Obrona na Wembley", 50),
    P("prl_lato", "Grzegorz Lato", ("pl", "Grzegorz Lato"), "green", "sport", 60, "Król strzelców '74", 45),
    P("prl_kora", "Kora", ("pl", "Kora (wokalistka)"), "green", "muzyka", 55, "Boskie Buenos", 40),
    P("prl_jantar", "Anna Jantar", ("pl", "Anna Jantar"), "green", "muzyka", 55, "Tyle słońca w całym mieście", 40),
    P("prl_himilsbach", "Jan Himilsbach", ("pl", "Jan Himilsbach"), "green", "kino", 60, "Rejs", 45),
]

# Skrzynki. Pola dodatkowe:
#   shop       - czy skrzynkę można kupić w sklepie
#   restricted - czy kupić mogą tylko gracze, którym admin dał dostęp
#   weights    - (opcjonalnie) własne szanse rzadkości dla tej skrzynki
#   shared     - (opcjonalnie) karty z innych skrzynek, które też są w tej skrzynce
CRATES = {
    "pl": {"name": "Skrzynka Polska", "short": "Polska", "code": "PL", "emoji": "🦅",
           "color1": "#ffffff", "color2": "#dc143c", "price": CRATE_PRICE, "shop": True, "restricted": False,
           "desc": "polskie gwiazdy, politycy i sportowcy", "people": PEOPLE_PL},
    "world": {"name": "Skrzynka Świat", "short": "Świat", "code": "ŚW", "emoji": "🌍",
              "color1": "#3d7bff", "color2": "#0e2a7a", "price": CRATE_PRICE, "shop": True, "restricted": False,
              "desc": "światowe gwiazdy i politycy", "people": PEOPLE_WORLD},
    "prl": {"name": "Skrzynka PRL", "short": "PRL", "code": "PRL", "emoji": "🏭",
            "color1": "#c8102e", "color2": "#3c3c3c", "price": 500, "shop": True, "restricted": False,
            "desc": "Polska Ludowa 1945–1989: władza, opozycja i gwiazdy epoki",
            "weights": {"green": 40.0, "blue": 30.0, "purple": 18.0, "red": 9.0, "gold": 3.0, "ultra": 0.5},
            "shared": ["pl_secret", "pl_walesa", "pl_krawczyk", "pl_rodowicz"],
            "people": PEOPLE_PRL},
}

# Drugie zdolności - mają je wszystkie karty legendarne, ULTRA i tajne
SECOND_ATTACKS = {
    "pl_malysz": ("Bułka z bananem", 120),
    "pl_walesa": ("Plusy dodatnie, plusy ujemne", 130),
    "pl_pilsudski": ("Cud nad Wisłą", 150),
    "pl_lewandowski": ("Rekord Bundesligi", 220),
    "pl_curie": ("Odkrycie polonu", 230),
    "pl_secret": ("Nie lękajcie się!", 280),
    "w_ronaldo": ("Rzut wolny z 35 metrów", 160),
    "w_messi": ("Osiem Złotych Piłek", 170),
    "w_jordan": ("Sześć pierścieni", 160),
    "w_trump": ("You're fired!", 220),
    "w_einstein": ("Teoria względności", 230),
    "w_secret": ("Debata na kampusie", 260),
    "prl_gierek": ("Druga Polska", 210),
    "prl_hermaszewski": ("Eksperyment na orbicie", 130),
    "prl_jaruzelski": ("Ciemne okulary", 140),
    "pl_korwin": ("Muszka bojowa", 120),
}
for _c in CRATES.values():
    for _p in _c["people"]:
        if _p["id"] in SECOND_ATTACKS:
            _p["attack2"], _p["dmg2"] = SECOND_ATTACKS[_p["id"]]


def card_value(person, variant="normal"):
    # valueMult: karty dostępne tylko w droższych skrzynkach są warte proporcjonalnie więcej (catalog.rebuild)
    v = RARITIES[person["rarity"]]["value"] * person.get("valueMult", 1)
    return int(round(v * VARIANTS.get(variant, VARIANTS["normal"])["mult"]))


# ============================================================ ARENA (wersja testowa - tylko dla adminów; turowa walka kartami)
# Talia 8 kart z kolekcji, 4 miejsca na planszy, reszta na ławce. Wygrywa ten, kto pokona wszystkie karty rywala.
ARENA = {
    "deckSize": 8, "boardSlots": 4, "actions": 2, "maxCoins": 10,
    # koszt wystawienia karty z ławki na planszę (złote monety) - z rzadkości
    "cardCost": {"green": 1, "blue": 2, "purple": 3, "red": 4, "gold": 5, "ultra": 6, "secret": 7},
    # domyślny koszt zdolności (monety) z jej wartości: [(od wartości, koszt)] - słabe za darmo
    "abilityCost": [[0, 0], [150, 1], [250, 2]],
    # nagrody: skrzynka z pieniędzmi (MONEY_CHESTS) za 1., 3. i 9. wygraną dnia
    "rewardWins": [1, 3, 9], "rewardChest": "daily",
}

# Wspólne efekty zdolności (admin przypisuje je w panelu). value / turns - co znaczą liczby przy danym efekcie.
# unique: efekt może mieć tylko JEDNA karta w grze (unikalne ataki).
ARENA_EFFECTS = {
    "burn":    {"name": "Podpalenie", "icon": "🔥", "value": "obrażenia na turę", "turns": True,
                "desc": "Zadaje obrażenia na początku każdej tury właściciela karty."},
    "poison":  {"name": "Trucizna", "icon": "☠️", "value": "obrażenia na turę", "turns": True,
                "desc": "Obrażenia co turę; zatrutej karty nie da się leczyć."},
    "stun":    {"name": "Ogłuszenie", "icon": "💫", "value": None, "turns": True,
                "desc": "Karta nie może nic robić przez podaną liczbę tur."},
    "shield":  {"name": "Tarcza", "icon": "🛡️", "value": "punkty osłony", "turns": True,
                "desc": "Pochłania obrażenia, zanim trafią w HP."},
    "heal":    {"name": "Leczenie", "icon": "💚", "value": "leczone HP", "turns": False,
                "desc": "Od razu przywraca HP (nie więcej niż na starcie)."},
    "taunt":   {"name": "Prowokacja", "icon": "📢", "value": None, "turns": True,
                "desc": "Rywal musi atakować tę kartę, dopóki prowokacja trwa."},
    "boost":   {"name": "Wzmocnienie", "icon": "💪", "value": "+obrażenia", "turns": True,
                "desc": "Zdolności tej karty zadają więcej obrażeń."},
    "weaken":  {"name": "Osłabienie", "icon": "🩸", "value": "-obrażenia", "turns": True,
                "desc": "Zdolności tej karty zadają mniej obrażeń."},
    "lifesteal": {"name": "Wampiryzm", "icon": "🧛", "value": "% zadanych obrażeń", "turns": False,
                  "desc": "Atakujący leczy się o część zadanych obrażeń."},
    "splash":  {"name": "Odłamki", "icon": "💥", "value": "obrażenia", "turns": False,
                "desc": "Rani też karty stojące obok celu."},
    # unikalne - każdy może mieć tylko jedna karta
    "steal_coins": {"name": "Kradzież monet", "icon": "💰", "value": "monety", "turns": False, "unique": True,
                    "desc": "Rywal ma mniej monet w następnej turze."},
    "extra_action": {"name": "Dodatkowa akcja", "icon": "⚡", "value": "akcje", "turns": False, "unique": True,
                     "desc": "Daje od razu dodatkowe akcje w tej turze."},
    "knockback": {"name": "Do ławki!", "icon": "🔁", "value": None, "turns": False, "unique": True,
                  "desc": "Odsyła trafioną kartę rywala z planszy na jego ławkę."},
}
ARENA_TARGETS = {"enemy": "wybrany wróg", "all_enemies": "wszyscy wrogowie", "self": "ta karta",
                 "ally": "wybrany sojusznik", "all_allies": "wszyscy sojusznicy"}
# cel efektu: "target" = ten sam co cel zdolności
ARENA_EFFECT_TARGETS = {"target": "cel zdolności", "self": "ta karta", "all_allies": "wszyscy sojusznicy",
                        "all_enemies": "wszyscy wrogowie", "random_enemy": "losowy wróg"}
# zabawne animacje zdolności
ARENA_VISUALS = {
    "hit":       {"name": "Zwykłe uderzenie", "icon": "👊"},
    "tomato":    {"name": "Rzut pomidorem", "icon": "🍅"},
    "lightning": {"name": "Piorun", "icon": "⚡"},
    "explosion": {"name": "Wybuch", "icon": "💥"},
    "money":     {"name": "Deszcz pieniędzy", "icon": "💸"},
    "mic":       {"name": "Fala z mikrofonu", "icon": "🎤"},
    "ball":      {"name": "Strzał piłką", "icon": "⚽"},
    "fire":      {"name": "Ogień", "icon": "🔥"},
    "ice":       {"name": "Lód", "icon": "❄️"},
    "hearts":    {"name": "Serduszka (leczenie)", "icon": "💖"},
    "bubble":    {"name": "Bańka ochronna", "icon": "🫧"},
}
MAX_ABILITY_EFFECTS = 3

# ============================================================ LISTA ZMIAN (pokazywana raz po aktualizacji)
# Najnowsza na górze. "v" musi rosnąć z każdą nową wersją - gracz zobaczy wpisy nowsze niż ostatnio obejrzany.
PATCH_NOTES = [
    {"v": 1, "date": "2026-10-14", "title": "Witaj w ScamBox!",
     "items": [
         "🏷️ Nowa nazwa: Skrzynki Sław to teraz <b>ScamBox</b>.",
         "👑 Nowy wariant <b>Królewski</b> — złota rama, klejnoty na krawędziach i korona. Wypada tylko ze <b>Skrzyni Królów</b>.",
         "🏳️ Nowy wariant <b>Flagowy</b> — karta w barwach flagi swojego kraju. Tylko w wybranych skrzynkach.",
         "💎 Wyjątkowe warianty wypadają wyłącznie ze skrzynek, które je mają — nie zrobisz ich w kontrakcie ani ulepszaczu.",
         "📰 Po każdej aktualizacji zobaczysz tu, co się zmieniło. Listę zmian znajdziesz też na swoim profilu.",
     ]},
]
