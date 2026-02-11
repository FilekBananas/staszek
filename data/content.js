(() => {
  const images = {
    main: "zdjęcia/zdjęcie_main.jpeg",
    program: "zdjęcia/zdjęcie_program.jpeg",
    staff: "zdjęcia/zdjęcie_sztab.jpeg",
    erasmus: "zdjęcia/erasmus-grafika.jpeg",
    posters: [
      {
        src: "zdjęcia/plakat-wyborczy-staszek-dla-staszica-plakat-glowny.jpeg",
        title: "Plakat główny",
        subtitle: "STASZEK DLA STASZICA",
      },
      {
        src: "zdjęcia/plakat-wyborczy-W_samo_poludnie_stanislaw_tomaszewski.jpeg",
        title: "W samo południe",
        subtitle: "Stanisław Tomaszewski",
      },
      {
        src: "zdjęcia/plakat-wyborczy_i_want_you_for_my_army.jpeg",
        title: "I want you for my army",
        subtitle: "La Familia wzywa",
      },
      {
        src: "zdjęcia/głosuj_na_staszka-plakat.jpeg",
        title: "Głosuj na Staszka",
        subtitle: "STASZEK DLA STASZICA",
      },
      {
        src: "zdjęcia/plakat-1.jpeg",
        title: "Staszek na ratunek",
        subtitle: "STASZEK DLA STASZICA",
      },
      {
        src: "zdjęcia/rzeczy_niemozliwe_robimy_od_reki-plakat.jpeg",
        title: "Rzeczy niemożliwe robimy od ręki",
        subtitle: "STASZEK DLA STASZICA",
      },
      {
        src: "zdjęcia/pracujemy_w_trojke-budujemy_za12-tu-plakat.jpeg",
        title: "Pracujemy w trójkę",
        subtitle: "Budujemy za 12",
      },
      {
        src: "zdjęcia/badz_jak_pingwin-plakat.jpeg",
        title: "Bądź jak pingwin",
        subtitle: "STASZEK DLA STASZICA",
      },
    ],
  };

  const program = [
    {
      id: 1,
      title: "Erasmus+",
      approved: true,
      tags: ["wyjazdy", "UE", "projekty"],
      lead:
        "Erasmus+ w Staszicu — wejście w projekty, wymiany i środki UE. Układ zawarty.",
      spotlightImage: images.erasmus,
      spotlightText: `Mam dla Was propozycję nie do odrzucenia. 🌹🍷

Erasmus+ w Staszicu.
Nie „spróbujemy”. Nie „zobaczymy”.

To jest PRZEJĘCIE unijnych zasobów. 🇪🇺💰

Wchodzimy w darmowe wyjazdy. Przejmujemy europejskie budżety. Budujemy imperium. 🌹🇮🇹
Dyrekcja? Dyrekcja przybiła już swoją pieczęć. 👀🤝
Układ jest zawarty.
Mam ich pełne poparcie i zielone światło na egzekucję planu. Nic ani nikt nie stanie nam na drodze.

Pytanie nie brzmi „czy się uda”.

Pytanie brzmi: czy jesteś w Rodzinie, czy stoisz z boku i patrzysz, jak inni wygrywają??

#staszekdlastaszica`,
    },
    {
      id: 2,
      title: "Budżet uczniowski",
      approved: true,
      tags: ["samorząd", "finanse", "projekty"],
      lead:
        "Uczniowie decydują o realnej puli środków — pomysły przechodzą z rozmów do realizacji.",
      spotlightImage: "zdjęcia/budzet_uczniowski.png",
      spotlightText: `Przychodzisz do mnie z genialnym i ambitnym pomysłem bądź propozycją, ale nie masz pieniędzy?

To wielki brak szacunku dla twoich możliwości🫶

A więc, złożę Ci propozycję nie do odrzucenia.

🌹 Budżet Uczniowski🌹

Koszty? Dla nas nie istnieją. Dysponujemy naprawdę każdymi środkami.

Tak, alla lettera każdymi, mamy absolutne carte blanche💰💰

Jesteśmy otwarci na wszystko. Cokolwiek zechcesz zorganizować na naszym terenie, załatwimy to.
I wiedz jedno, mamy na to pełne błogosławieństwo samej Dyrekcji. Góra przybiła swoją pieczęć. Nikt nie będzie zadawał zbędnych pytań.

Przynieś Nam wniosek, moi Consiglieri zajmą się resztą 🔫🍷

Capisci?????🇮🇹

#staszekdlastaszica`,
    },
    {
      id: 3,
      title: "STS Pogoria",
      approved: true,
      tags: ["wyjazdy", "integracja"],
      lead:
        "Więcej wspólnych działań poza szkołą — integracja, sport, odpoczynek i klimat Staszica.",
    },
    {
      id: 4,
      title: "Zniżki dla wszystkich uczniów w wybranych lokalach",
      approved: true,
      tags: ["zniżki", "benefity"],
      lead:
        "Negocjacje z lokalami — zniżki, które działają dla każdego ucznia (nie tylko ‘dla znajomych’).",
    },
    {
      id: 5,
      title: "Szkolny serwer Minecraft",
      approved: true,
      tags: ["gaming", "społeczność"],
      lead:
        "Serwer dla Staszica — wspólna zabawa, eventy i budowanie społeczności (bez dram).",
    },
    {
      id: 6,
      title: "Wspólny dysk z notatkami",
      approved: true,
      tags: ["nauka", "współpraca"],
      lead:
        "Porządek w materiałach: jeden dysk, sensowna struktura, szybkie znajdowanie notatek.",
    },
    {
      id: 7,
      title: "TEDxYouth",
      approved: true,
      tags: ["wydarzenia", "inspiracja"],
      lead:
        "Wielkie wystąpienia i wielkie idee — scena dla uczniów, prelegentów i projektów.",
    },
    {
      id: 8,
      title: "Zakup mikrofalówek na stołówkę",
      approved: true,
      tags: ["stołówka", "komfort"],
      lead:
        "Mikrofalówki na stołówce — prosto, praktycznie i z korzyścią na co dzień.",
    },
    {
      id: 9,
      title: "Szkolne koło MUN-owe",
      approved: true,
      tags: ["debata", "dyplomacja"],
      lead:
        "Model United Nations w Staszicu — debaty, symulacje i trening argumentów w praktyce.",
    },
    {
      id: 10,
      title: "Postulat specjalny",
      approved: true,
      tags: ["specjalny"],
      lead:
        "Punkt ‘specjalny’ — miejsce na propozycję, którą ogłosimy w odpowiednim momencie.",
    },
    {
      id: 11,
      title: "Targi uniwersyteckie",
      approved: true,
      tags: ["przyszłość", "studia"],
      lead:
        "Spotkania z uczelniami — konkretne informacje, kierunki, ścieżki i wybór bez zgadywania.",
    },
    {
      id: 12,
      title: "Powrót staszicowych skarpetek",
      approved: true,
      tags: ["merch", "klimat"],
      lead:
        "Legenda wraca — staszicowe skarpetki znowu dostępne (tak jak powinno być).",
    },
    {
      id: 13,
      title: "Kontynuacja postulatów",
      approved: true,
      tags: ["ciągłość", "realizacja"],
      lead:
        "Nie zrywamy projektów — kontynuujemy to, co działa, i dowozimy nowe rzeczy do końca.",
    },
  ];

  const staff = [
    "Filip Biskupski (Webmaster)",
    "Mateusz Dornowski (Senator & Chief of Staff)",
    "Oskar Sienkiewicz (Visual Aesthetics Manager)",
    "Wojciech Kwiatkowski",
    "Łukasz Parda",
    "Kuba Świcarz",
    "Dawid Chudzik",
    "Stanisław Lewandowski",
    "Mateusz Mieszkowski",
    "Oliwier Kwiatkowski",
    "Borys Pietrewicz",
    "Adam Rowiński",
    "Ilya Lapshin",
    "Kostek Opas",
    "Ryszard Karaś",
    "Aleksander Kołtuński",
    "Przemysław Kamiński",
    "Adam Zaleski",
    "Miron Ławrynowicz",
    "Maksymilian Wysokiński",
    "Krzysztof Stachowiak",
    "Piotr Goździk",
    "Patryk Niewczas",
    "Nikita Harhots",
    "Maciej Sołowiński",
    "Alex Dubis",
    "Szymon Kaczkowski",
    "Mikołaj Głowacki",
    "Kuba Dyrektor",
    "Paweł Palenik",
  ];

  const staffLinks = {
    "Adam Rowiński": "https://www.facebook.com/profile.php?id=61567398682653",
    "Adam Zaleski": "https://www.facebook.com/adqsss",
    "Borys Pietrewicz": "https://www.facebook.com/profile.php?id=61579357974844",
    "Kostek Opas": "https://www.facebook.com/kostek.opas.92",
    "Maksymilian Wysokiński": "https://www.facebook.com/profile.php?id=100080527871606",
    "Mateusz Dornowski": "https://www.facebook.com/matijos.matijos",
    "Mikołaj Głowacki": "https://www.facebook.com/miki.glowa",
    "Paweł Palenik": "https://www.facebook.com/profile.php?id=61577903663868",
    "Ryszard Karaś": "https://www.facebook.com/profile.php?id=61570875586851",
    "Szymon Kaczkowski": "https://www.facebook.com/fitmatelindo12",
  };

  const news = [
    {
      id: "post-paczki-quiz",
      title: "Test wiedzy o pączkach — Giovedì Grasso",
      date: "",
      tags: ["quiz", "pączki", "tłusty czwartek"],
      body: `Buongiorno, moi drodzy amici🫶

W czwartek świętujemy Giovedì Grasso. Z tej okazji organizujemy mały quiz.

Szukajcie pytań na naszym story w czwartek o: 9:00, 9:55, 10:50, 11:45, 12:40 i 12:50.

Sprawa wygląda tak: macie 10 minut na wysłanie odpowiedzi i waszych imion. Kto pierwszy, ten lepszy. Dostaniecie od nas potwierdzenie czy się udało 😉

10 najszybszych zgarnia pączka. Za darmo🇮🇹

Odbiór towaru na przerwie po 6. albo 7. lekcji (dla tych którzy wychodzą wcześniej już po 5.).
Wiem, że mnie nie zawiedziecie.
Ciao🇮🇹🇮🇹
Wasz kandydat
Stanisław Tomaszewski🫶🫶

Inspiracja @kornel.2025 ❤️`,
    },
    {
      id: "post-video-2",
      title: "Filmik #2 — STASZEK DLA STASZICA",
      date: "",
      video: "video/film_wyborczy_2.mp4",
      image: "",
      tags: ["video", "kampania"],
      body: `#staszekdlastaszica`,
    },
    {
      id: "post-video-1",
      title: "Filmik — STASZEK DLA STASZICA",
      date: "",
      video: "video/filmik_staszek_dla_staszica_1.mp4",
      image: "",
      tags: ["video", "kampania"],
      body: `Nowy filmik kampanii.

#staszekdlastaszica`,
    },
    {
      id: "post-budzet",
      title: "Budżet uczniowski — propozycja nie do odrzucenia",
      date: "",
      image: "zdjęcia/budzet_uczniowski.png",
      tags: ["budżet", "samorząd", "dyrekcja"],
      body: `Przychodzisz do mnie z genialnym i ambitnym pomysłem bądź propozycją, ale nie masz pieniędzy?

To wielki brak szacunku dla twoich możliwości🫶

A więc, złożę Ci propozycję nie do odrzucenia.

🌹 Budżet Uczniowski🌹

Koszty? Dla nas nie istnieją. Dysponujemy naprawdę każdymi środkami.

Tak, alla lettera każdymi, mamy absolutne carte blanche💰💰

Jesteśmy otwarci na wszystko. Cokolwiek zechcesz zorganizować na naszym terenie, załatwimy to.
I wiedz jedno, mamy na to pełne błogosławieństwo samej Dyrekcji. Góra przybiła swoją pieczęć. Nikt nie będzie zadawał zbędnych pytań.

Przynieś Nam wniosek, moi Consiglieri zajmą się resztą 🔫🍷

Capisci?????🇮🇹

#staszekdlastaszica`,
    },
    {
      id: "post-sts-pogoria",
      title: "STS Pogoria — propozycja nie do odrzucenia",
      date: "",
      image: "zdjęcia/sts-pogonia.png",
      tags: ["sts", "pogoria", "wyjazdy", "integracja"],
      body: `Słuchajcie moi compagni. Sprawy zaczynają nabierać tempa🤫🤫

Mamy już ludzi (kadra gotowa).
Mamy również błogosławieństwo samej Góry (zielone światło od Dyrekcji)🤝

Interes jest już ubity🫶

STS Pogoria. To nie jest zwykła wycieczka szkolna.

To bilet do innego świata.

Płyniemy tam, gdzie życie smakuje najlepiej. Między innymi Monte Carlo, Portofino, Genua.
Będziemy spacerować tam, gdzie najbogatsi tego świata. Kąpać się na otwartym morzu, skakać z lin do błękitnej wody i wciągać włoskie lody najlepszego sortu.

To przygoda, która zostaje w głowie na całe życie. Wracasz stamtąd inny. Bardziej pewny siebie. Z wizją jak wspaniały może być ten świat i jak dużo jeszcze mamy przed sobą.

To oferta dla tych, którzy chcą od życia czegoś więcej.

Inne życie czeka. To propozycja nie do odrzucenia🇮🇹🇮🇹🍷

#staszekdlastaszica`,
    },
    {
      id: "post-program",
      title: "#STASZEK DLA STASZICA — 13 punktów",
      date: "",
      image: images.program,
      tags: ["program", "dyrekcja"],
      body: `Przychodzę dziś do Was z szacunkiem, by złożyć propozycję nie do odrzucenia. 🌹🍷

Na stole kładę 13 konkretnych punktów.
Od wprowadzenia Erasmusa+ , poprzez włączające inicjatywy, aż po powrót legendarnych staszicowych skarpetek.
To nie jest lista życzeń. To kontrakt dla Rodziny Staszica, który został już wynegocjowany.

Mogę Wam oficjalnie ogłosić: Mamy zielone światło od Dyrekcji na WSZYSTKIE postulaty. 👀🤝
Góra zaakceptowała plan, a więc zabawa oficjalnie się zaczyna🔫
Kto to zrealizuje?
Nie ja sam. Zrobi to moja La Familia. 🇮🇹

Mój sztab to ludzie wybitni, ambitni i bezwzględnie skuteczni. To oni dopilnują każdego szczegółu. Kiedy my mówimy, że coś zrobimy, praktycznie jest to już zrobione.
Przeanalizujcie te punkty. Kolejne karty odkryjemy w najbliższych dniach.
Wybierzcie mądrze🫶

#staszekdlastaszica`,
    },
    {
      id: "post-erasmus",
      title: "Erasmus+ w Staszicu",
      date: "",
      image: images.erasmus,
      tags: ["erasmus", "UE", "wyjazdy"],
      body: program[0].spotlightText,
    },
    {
      id: "post-main",
      title: "Przychodzę z propozycją",
      date: "",
      image: images.main,
      tags: ["start", "kim-jestem"],
      body: `Przychodzę dziś do Was z szacunkiem, by prosić o zaufanie, a zarazem złożyć propozycję nie do odrzucenia.🇮🇹🇮🇹

Nazywam się Stanisław. Niektórzy znają mnie z Genewy , inni z korytarzu, jeszcze inni z kółek i wyników. Jestem na profilu MAT-FIZ-INF, ale liczby to dla mnie nie wszytko. Prawdziwa zabawa zaczyna się tam, gdzie trzeba zarządzać ludźmi i kierować projektami.
Bylem koordynatorem wielu projektów uczniowskich, między innymi naszego szkolnego projektu w konkursie AGO allience, mojego zespołu AeroDynamics w Learn&Fly, i wiele innych. Ponadto jestem CMO I CCO w zespole STEM Racing (STC Racing). Kiedy Wy odpoczywacie, ja koordynuję projekty, załatwiam sponsorów i dbam o to, by machina działała sprawnie. Ponadto walczę w Olimpiadzie Fizycznej, póki co udało mi się dojść do cześć doświadczalnej, a więc wiem, co to znaczy z sukcesem mierzyć wysoko.🚀🚀

Szkola to nie tylko nauka. To dyplomacja🤝
Pasjonuję się debatowaniem, gdyż wiem, że słowa mają wagę, a argumenty siłę zdolną przesuwać góry. Tę właśnie siłę wykorzystuję w praktyce. Jako koordynator wielu inicjatyw, wielokrotnie siadałem do stołu z Dyrekcją, by twardo negocjować warunki dla uczniów. Wychodziłem z tych spotkań ze skutecznie załatwionymi sprawami. Angażuję się od dawna w wolontariat, bo dobry lider musi dbać o swoją społeczność, działać na rzecz innych osób.
A mój uśmiech? Mówią, że potrafię się ładnie uśmiechać. Wierzę, że jest to naprawdę przydatne narzędzie, otwiera drzwi, które dla innych pozostają zamknięte.

Nie obiecuję cudów. Obiecuję skuteczność🫶

Pamiętajcie o tym przy urnach🥂🌹🇮🇹`,
    },
    {
      id: "post-staff",
      title: "La Familia — sztab",
      date: "",
      image: images.staff,
      tags: ["sztab", "ludzie"],
      body: `Prawdziwa siła to nie jednostka. To La Familia.
To ludzie, którym ufam bezgranicznie. Moi Consiglieri.
 Nie pytajcie, co oni robią dla szkoły. Pytajcie, czego nie byliby w stanie zrobić.🔫
Razem pilnujemy interesów Staszica.
Z nami się nie dyskutuje. Z nami się współpracuje.🌹🇮🇹

W skład sztabu wchodzą najlepsi z najlepszych🫶:`,
    },
  ];

  news.find((p) => p.id === "post-staff").body += `\n\n${staff
    .map((n) => `- ${n}`)
    .join("\n")}`;

  const cooperationEssay = `Twoja wizja współpracy różnych Organów Samorządu Uczniowskiego
With <3 by Stanisław Tomaszewski

No więc, wyobraźmy sobie Samorząd Uczniowski, który wcale nie jest jak te zestawy klocków Lego – każdy sobie, a razem jakoś ledwo trzymają się kupy. Tu chodzi o taki układ, gdzie różne organy naprawdę grają do tej samej bramki, a nie wciskają się na siłę, jednocześnie próbując być szefem. Bo serio, kto lubi chaos, co nie?

W mojej wizji... no cóż, kluczem do sukcesu jest, żeby każdy znał swoje miejsce – niech każdy robi to, co potrafi najlepiej, i nikt nie próbuje namieszać tam, gdzie nie trzeba. A jeszcze lepiej, gdy wszyscy dogadują się na jasnych zasadach, od A do Z, bo bez tego to jak gra w piłkę bez sędziego – kto chce, ten może kopać, a reszta się zastanawia, o co chodzi.

Weźmy na przykład Komisję Wyborczą, ich zadaniem jest ogarnąć wybory. Proste, nie? Zero stronniczości, żadnych faworyzacji, czysta robota. Bez tego nie ma zabawy. Trybunał Regulaminowy zrobi za sędziego i kogoś, kto przy okazji pogodzi spory, gdy zacznie się niepotrzebne zamieszanie.

No a Senat? To takie miejsce, gdzie można pogadać, trochę poobserwować, no i pilnować, czy wszystko gra, zwłaszcza co robi władza wykonawcza. Prezydent Samorządu to nie boss, co krzyczy „ja tu rządzę”, tylko taki pan od koordynacji – trochę jak dyrygent, który pilnuje, by orkiestra zagrała razem (tak, wiem, nie każdy lubi orkiestry, ale to dobra metafora, serio).

I teraz, żeby wszystko to miało ręce i nogi, trzeba jeszcze dobrze gadać, a tu mowa o komunikacji jasnej jak słońce na niebie. Wszelkie informacje o wyborach, dyskusjach czy konsultacjach winny pojawić się jednocześnie na szkolnej stronie i w kanałach samorządowych, bo inaczej szybko robi się bałagan, a przecież nie chcemy, żeby ktoś przegapił coś ważnego, prawda?

No i dobrze by było, żeby każde „tak jest”, czyli decyzje komisji i trybunału miały krótkie wyjaśnienie oparte na regulaminie, trochę przezroczystości nikomu nie zaszkodzi, a wręcz przeciwnie, pozwala uniknąć telepatycznego zgadywania, dlaczego coś akurat tak, a nie inaczej.

A kiedy przychodzi czas wyborów, no to wtedy każda część samorządu ma swoje 5 minut: Komisja układa harmonogram i trzyma rękę na pulsie, Senat, organizuje debatę, żeby nikt nie siedział cicho, a reszta pomaga w sprawach organizacyjnych, ale spokojnie, bez wchodzenia w krzykliwą rywalizację kandydatów.

W ten sposób kampania jest fair, a uczniowie mają czyste info, na którym mogą się oprzeć, wybierając swoich reprezentantów. Nie zapominajmy o kontroli i rozwiązywaniu konfliktów – bo nie wszystko zawsze pójdzie gładko, oj nie.

Moim zdaniem ważne jest, żeby były jasne ścieżki odwoławcze, krótkie terminy i żeby osoby uczestniczące w sporze odpadały z oceny sprawy, inaczej to robi się trochę chaotyczne.

W sumie, samorząd powinien być jak dobrze naoliwiona maszyna, gdzie części się nie gryzą na śmierć, tylko działają na rzecz jakiegoś wspólnego dobra.

I najważniejsze, współpraca nie kończy się po wynikach wyborów. Trzeba potem wspólnie spojrzeć, co poszło gładko, a gdzie jeszcze coś zgrzytało. Tylko wtedy da się zrobić coś lepiej następnym razem. Bo serio, nie ma nic nudniejszego niż wciąż ten sam bałagan bez nauki na błędach, prawda?

Podsumowując (ale nie oficjalnie), samorząd marzeń to taki, co działa razem, nie jak banda amatorów każdego na swojemu. Przejrzystość, szacunek dla kompetencji i rozmowa, trochę jak podczas przerw między lekcjami, to właśnie daje prawdziwy głos uczniom. No i jeszcze fajne uczucie, że nie jesteśmy sami w tej szkolnej dżungli.

Stanisław Tomaszewski 1C.`;

  window.STASZEK = {
    candidate: {
      name: "Stanisław Tomaszewski",
      className: "1C",
      profile: "MAT‑INF‑FIZ",
      title: "Kandydat na Prezydenta Staszica",
    },
    hashtag: "#staszekdlastaszica",
    images,
    program,
    staff,
    staffLinks,
    news,
    cooperationEssay,
  };
})();
