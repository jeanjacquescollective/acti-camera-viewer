# Monitor

[English](README.en.md) · **Nederlands**

Bekijk je IP-camera's op je pc, gsm of tablet. **OVERVIEW** toont van elke camera een beeld dat elke seconde ververst.
Klik op een camera om ze **LIVE** te bekijken. LIVE toont 1, 4, 6, 8 of 9 camera's tegelijk, en jij kiest welke camera
waar komt. Werkt in elke browser: geen ActiveX of Internet Explorer nodig, zoals oude ACTi-camera's vroeger vroegen.

Gemaakt voor ACTi-camera's (zoals de ACM-5601), maar andere merken met een snapshot- of RTSP-adres werken ook.

**Inhoud**

- [Wat heb je nodig](#wat-heb-je-nodig)
- [Hardware opstellen](#hardware-opstellen)
- [Netwerkkabels](#netwerkkabels)
- [Installeren (stap voor stap)](#installeren-stap-voor-stap)
- [Je eerste camera aansluiten](#je-eerste-camera-aansluiten)
- [Dagelijks gebruik](#dagelijks-gebruik)
- [Kijken op je gsm of een andere pc](#kijken-op-je-gsm-of-een-andere-pc)
- [Problemen?](#problemen)
- [Voor ontwikkelaars](#voor-ontwikkelaars)

---

## Wat heb je nodig

- Een **Windows 10- of 11-pc** die aan blijft zolang je wilt kijken. Deze pc praat met de camera's; gsm's en andere pc's
  kijken via deze pc mee.
- Eén of meer **IP-camera's**, aangesloten op dezelfde router of netwerkswitch als de pc.
- Per camera een **netwerkkabel**, zie hieronder.
- Optioneel: **ffmpeg**, een gratis programma dat het livebeeld vloeiender maakt (zie stap 3 van de installatie).
  Monitor werkt ook zonder.

## Hardware opstellen

Alles hangt aan je router, meestal via een **netwerkswitch** (een kastje met extra netwerkpoorten):

```
                      Internet
                         │
                     [ Router ] ──── wifi ──── gsm's, tablets, laptops
                         │
        [ PoE-switch ] ──┴── Monitor-pc (met een kabel, niet via wifi)
         │    │    │
       cam1 cam2 cam3 …
```

- **Monitor-pc met een kabel.** Al het camerabeeld gaat door deze pc, dus geef hem een netwerkkabel naar de router of
  switch. Via wifi werkt het ook, maar minder vlot met meerdere camera's.
- **Een switch voor de camera's.** Weinig vrije poorten op je router? Een switch voegt er toe. Een **PoE-switch** geeft de
  camera's ook stroom via de netwerkkabel, zodat een camera aan de muur maar één kabel nodig heeft. Let op het PoE-budget:
  reken op ongeveer **7 W per camera** (meer met nachtlampjes/IR) en kies een switch met een totaal "PoE budget" dat hoger
  ligt.
- **Geen PoE?** Dan heeft elke camera een eigen stroomadapter bij de camera nodig, of per camera een **PoE-injector** (een
  adaptertje dat stroom op de kabel zet).
- **Plaatsing.** Hang camera's buiten handbereik en onder een afdak (regen en volle zon verkorten hun leven). Niet naar een
  lamp of de zon gericht: dan wordt het beeld wit. Binnencamera's (zoals de ACM-5601) zijn niet waterdicht: buiten neem je
  een buitencamera of een beschermkast.
- **Stroompanne.** Wil je dat de camera's even blijven werken? Zet router, switch en pc op een kleine **UPS**
  (noodbatterij).
- **Draadloze camera's** (wifi) werken ook, zolang ze een vast adres in je netwerk hebben. Een kabel is betrouwbaarder.

## Netwerkkabels

Camera's sluit je aan met gewone netwerkkabels (RJ45, ook "UTP-" of "ethernetkabel" genoemd). Kort:

| | Advies |
|---|---|
| **Type** | **Cat6** voor nieuwe kabels. Cat5e is ook prima (camera's gebruiken veel minder dan de 1 Gbit/s ervan). Vermijd Cat5 en ouder. |
| **Lengte** | Maximaal **100 m** per kabel, van de camera tot de switch of router. Langer kan alleen met een switch ertussen. |
| **Koper** | Koop **volkoper** ("solid copper" / "100% koper"). Goedkope **CCA**-kabel (aluminium met een laagje koper) breekt sneller en geeft problemen met PoE. |
| **Buiten** | Een **buitenkabel** (zwart, UV-bestendige PE-mantel). Binnenkabel wordt bros in de zon. In de grond: in een buis, of grondkabel met gelvulling. |
| **PoE** | Stroom via de netwerkkabel: één kabel voor beeld en stroom. Alleen als camera én switch het ondersteunen (kijk op het etiket of in de handleiding, "802.3af"). Anders gebruik je de stroomadapter van de camera. |
| **Stekkers** | Kant-en-klare kabels zijn het makkelijkst. Zelf krimpen: gebruik aan beide kanten dezelfde norm (**T568B**). |

Platte kabels en heel dunne kabels zijn oké voor korte stukken binnen, maar niet voor lange stukken of PoE.

## Installeren (stap voor stap)

### 1. Monitor installeren

Je kreeg één van deze twee bestanden:

- **`Monitor_1.2.0_x64-setup.exe`** (de app, aangeraden): dubbelklik erop, Monitor installeert zichzelf. Start daarna
  **Monitor** via het Startmenu. Het opent in een eigen venster.
- **`Monitor.exe`** (zonder installatie): zet het in een eigen map, bv. `Documenten\Monitor`, en dubbelklik erop. Er
  opent een zwart venster (laat dat open: dat is Monitor zelf) en je browser toont Monitor.

Zegt Windows *"Windows heeft uw pc beschermd"*? Dat komt doordat het programma geen betaalde handtekening heeft. Klik
op **Meer informatie** en dan **Toch uitvoeren**.

### 2. Toelaten in de firewall

De eerste keer vraagt Windows of Monitor het netwerk mag gebruiken. Vink **Privénetwerken** aan en klik op
**Toegang toestaan**. Dat is nodig om vanaf je gsm of een andere pc te kijken.

### 3. Optioneel: vloeiender beeld met ffmpeg

Zonder ffmpeg toont Monitor een paar beelden per seconde. Met ffmpeg krijg je vloeiende video.

1. Klik op Start, typ **Terminal** en open het.
2. Typ `winget install Gyan.FFmpeg` en druk op Enter. Bevestig met `Y` als het gevraagd wordt.
3. Sluit Monitor en start het opnieuw.

Onder SETUP > ADVANCED > SYSTEM zie je of Monitor ffmpeg gevonden heeft.

### 4. Automatisch starten met Windows (optioneel)

Druk op **Windows-toets + R**, typ `shell:startup` en druk op Enter. Er opent een map: zet daar een snelkoppeling naar
Monitor in (rechtsklik op het Monitor-icoon > *Meer opties weergeven* > *Snelkoppeling maken*, en sleep die naar de map).

## Je eerste camera aansluiten

Nieuwe ACTi-camera's starten op adres `192.168.0.100`, login `Admin` / `123456`. Je thuisnetwerk gebruikt meestal een
andere reeks (bv. `192.168.1.x`), dus eerst kan je pc de camera niet bereiken. Monitor lost dat voor je op:

1. Sluit de camera aan op de router of switch en wacht een minuutje tot hij opgestart is.
2. Klik rechtsboven op **NETWORK** en dan op **SCAN**. Monitor zoekt het netwerk af.
3. Is de camera **niet bereikbaar** vanaf je pc? Klik bij de camera op **PUT PC IN THIS RANGE** en dan op
   **ADD PC ADDRESS**. Windows vraagt toestemming: klik op **Ja**. Je pc krijgt er een adres bij; internet blijft werken.
4. Klik opnieuw op **SCAN**. Klik dan bij de camera op **CHANGE IP**: Monitor stelt een vrij adres in je thuisnetwerk
   voor. Klik op **CHANGE**. De camera herstart (ongeveer een minuut).
5. Klik op **ADD TO MONITOR**. Je komt in SETUP met de camera ingevuld. Controleer de login en klik op **SAVE**.
6. Optioneel: verwijder het extra pc-adres weer onder NETWORK > THIS PC (**REMOVE**).

Klaar: de camera staat in **OVERVIEW**. Staat er *NO SIGNAL*? Gebruik **TEST SNAPSHOT** in SETUP: dat toont een beeld,
of de precieze fout.

## Dagelijks gebruik

**OVERVIEW** toont alle camera's. Klik op een camera om ze LIVE te bekijken.

**LIVE** vult het hele scherm. Tik op het beeld (of druk op `C`) voor de knoppen:

- **1 / 4 / 6 / 8 / 9**: hoeveel camera's tegelijk. Elke camera krijgt een even groot deel van het scherm.
- **Camera's kiezen**: klik op een vak (groen kader) en kies de camera in het menu onderaan, of blader met de pijltjes.
  Zo toont een 4-scherm bijvoorbeeld camera 1, 4, 8 en 9.
- **Dubbelklik** op een vak (dubbeltik op een gsm): alleen die camera. Opnieuw dubbelklikken of `Esc` gaat terug.
- **SNAPSHOT** bewaart een foto. **LINK** geeft het adres van deze weergave voor een ander toestel.
- **FILL** laat het beeld het hele scherm vullen zonder zwarte balken (de randen vallen weg). Handig op een gsm.
- **FULLSCREEN**, of druk op `F`.

**SETUP** bevat de camera-instellingen. **BASIC** toont wat je nodig hebt: naam, adres, login en **DAY/NIGHT**
(**AUTO**: kleur overdag en zwart-wit in het donker, **DAY**: altijd kleur, **NIGHT**: altijd zwart-wit). Dag/nacht past
de camera meteen aan. Voor de rest klik je onderaan op **SAVE**. **ADVANCED** toont alle opties.

**NETWORK** gaat over adressen: camera's vinden, ze een IP-adres geven, en de adressen van deze pc.

**Toetsen in LIVE:** `C` knoppen aan/uit · `1` `4` `6` `8` `9` indeling · `↑` `↓` vak kiezen · `←` `→` vorige/volgende
camera · `Z` vullen · `F` volledig scherm · `L` link · `Esc` terug

## Kijken op je gsm of een andere pc

De pc met Monitor moet aan blijven, en het andere toestel moet op **hetzelfde netwerk** zitten (zelfde router of wifi).

1. In OVERVIEW staat bovenaan **OTHER PCs** met een adres zoals `http://192.168.1.25:8080`. Klik op **COPY**.
2. Open dat adres in de browser van je gsm of andere pc. Maak er een bladwijzer van, of op je gsm: *Toevoegen aan
   startscherm*.

Eén camera of een vaste reeks camera's heeft een eigen adres: gebruik **LINK** in LIVE.

**Tip:** je router kan de pc na een herstart een ander adres geven, en dan werkt de bladwijzer niet meer. Geef de pc in de
instellingen van je router een vast adres ("DHCP-reservering").

## Problemen?

**Een camera toont NO SIGNAL**
- Controleer de kabel en de stroom van de camera (knippert er een lampje aan de netwerkpoort?).
- SETUP > **TEST SNAPSHOT** toont de precieze fout. *Wrong user name or password*: verbeter de login en SAVE.
  *Timeout*: de pc bereikt de camera niet, zie NETWORK > SCAN.

**De gsm of andere pc laadt Monitor niet**
- Zit de gsm op dezelfde wifi, en niet op een gastnetwerk? Gast-wifi blokkeert dit vaak.
- Firewall: open op de Monitor-pc PowerShell **als administrator** en voer uit:
  ```powershell
  New-NetFirewallRule -DisplayName "Monitor" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
  ```
  Kijk ook bij Instellingen > Netwerk en internet of je netwerk op **Privé** staat, niet op Openbaar.
- Heb je je pc ooit zelf een vast `192.168.0.x`-adres gegeven om een camera te bereiken? Zet hem terug op automatisch
  (NETWORK > THIS PC > **BACK TO AUTOMATIC**).

**Het beeld schokt of loopt achter** — Installeer ffmpeg (stap 3). Nog vertraging? SETUP > ADVANCED > CONNECTION & LIVE
DELAY > preset *LOWEST DELAY*.

**Firmware-updates of een back-up van de instellingen** — Dat doet Monitor niet; gebruik daarvoor de ACTi IP Utility.
NETWORK > **OPEN IP UTILITY** start ze als haar map (`IP_Utility_...`) naast Monitor staat.

**Veiligheid** — Monitor heeft geen eigen login: iedereen op je netwerk kan meekijken en instellingen wijzigen. Gebruik
het alleen thuis of op het werk, en zet poort 8080 nooit open naar het internet in je router.

---

## Voor ontwikkelaars

### Snel opzetten

Nodig: Node.js 20+ en Windows (de netwerkpagina gebruikt PowerShell; de viewer zelf draait ook elders).

```powershell
git clone <repo> acti-camera-viewer
cd acti-camera-viewer
npm install
winget install Gyan.FFmpeg     # optioneel: RTSP-modus
npm run dev                    # http://localhost:8080, opent de browser (npm run serve: zonder browser)
```

De eerste start maakt `cameras.json` aan met een standaardcamera (`192.168.0.100`, `admin` / `123456`). Dat bestand
staat in `.gitignore` omdat er wachtwoorden in staan. Er is geen buildstap voor de server: pas `server.js` of `public/`
aan en herstart (voor `public/` volstaat herladen).

### Bouwen

- `npm run build:exe` → `dist\Monitor.exe`: een kopie van `node.exe` met `server.js` en `public/` erin (Node single
  executable application). Sluit eerst een draaiende Monitor. In `dist\` gebruikt de exe de `cameras.json` van het
  project; elders een `cameras.json` naast de exe. Zet er `ffmpeg.exe` naast en Monitor gebruikt die.
- `npm run build:app` → de Tauri-desktopapp met installer
  (`src-tauri\target\release\bundle\nsis\Monitor_<versie>_x64-setup.exe`). Bouwt eerst de exe en voegt die toe als
  sidecar. Nodig: Rust (`winget install Rustlang.Rustup`) en de Visual Studio C++ build tools; de eerste build duurt een
  paar minuten. De app bewaart haar instellingen in `%APPDATA%\com.monitor.cameraviewer\cameras.json`, het log in
  `monitor.log` ernaast. Draait er al een andere Monitor op dezelfde poort, dan toont de app die.

### Opbouw

| | |
|---|---|
| `server.js` | HTTP-server: cameraproxy (snapshot/RTSP via ffmpeg), instellingen-API, netwerk-/ONVIF-/ACTi-functies |
| `public/` | De webpagina's: `index.html` + `app.js` (overview en LIVE), `settings.*`, `network.*`, `modal.js`, `style.css` |
| `src-tauri/` | Desktopapp (Rust/Tauri): start de server verborgen en toont de pagina's in een venster |
| `build-exe.js`, `build-app.js` | Buildscripts |

### API (kort)

`GET /api/cameras` status van alle camera's · `GET /api/cameras/:id/snapshot` één JPEG · `GET /api/cameras/:id/stream`
MJPEG · `GET /api/multistream?id=1&id=2` meerdere camera's over één verbinding (multipart, elk deel met `X-Camera`) ·
`GET|PUT /api/config` instellingen · `POST /api/camera-video` ACTi-video en dag/nacht lezen/instellen ·
`/api/network/*` scan, camera-IP, pc-adressen.

LIVE-adressen: `#live=4&cams=1,4,8,9` (leeg vak: `cams=1,,8,9`); oude `#cam=1`-links werken nog.

### cameras.json

SETUP past dit bestand aan. Met de hand kan ook; herstart Monitor daarna.

```json
{
  "port": 8080,
  "overviewRefreshMs": 1000,
  "cameras": [
    { "id": "1", "name": "Inkom", "host": "192.168.0.100", "user": "admin", "password": "123456" },
    { "id": "2", "name": "Tuin",  "host": "192.168.0.101", "user": "admin", "password": "123456", "mode": "rtsp", "fps": 10 }
  ]
}
```

| Veld | Standaard | Betekenis |
|---|---|---|
| `host` | | IP-adres van de camera |
| `user` / `password` | `admin` / `123456` | Login van de camera |
| `mode` | `snapshot` | `snapshot`: vraagt telkens een JPEG op (geen extra software). `rtsp`: decodeert de RTSP-stream met ffmpeg (vloeiender) |
| `fps` | `5` | Beelden per seconde in het livebeeld |
| `httpPort` / `rtspPort` | `80` / `7070` | Poorten van de camera |
| `snapshotUrl` / `rtspUrl` | ACTi-adressen | Eigen adres voor andere cameramerken |
| `rtspTransport` | `tcp` | `tcp` of `udp` |
| `lowDelay`, `fastStart`, `jitterMs`, `pacing`, `jpegQuality`, `dropLate` | zie hieronder | Opties voor de vertraging |

### RTSP en automatisch terugvallen

Snapshots zijn het vangnet; RTSP draait daarbovenop op de achtergrond, zodat het beeld nooit stopt:

- Bij het openen van een camera starten snapshots meteen terwijl RTSP verbindt. Zodra RTSP beeld geeft, neemt het over.
- RTSP-beelden ongeveer 1 s te laat: snapshots vullen aan. 3 s geen beeld, of geen beeld binnen 8 s na verbinden:
  ffmpeg herstart.
- Nieuwe pogingen na 1 s, 3 s, 10 s, 30 s, daarna elke 60 s. Een stream die 30 s goed liep, begint het schema opnieuw.

LIVE toont linksonder de actieve modus (`RTSP`, `SNAPSHOT (CONNECTING RTSP)`, …) als de knoppen open staan.

**Vertraging** (SETUP > ADVANCED > CONNECTION & LIVE DELAY):

| Optie | Laagste vertraging | Gebalanceerd (standaard) | Vloeiendst |
|---|---|---|---|
| Decoderen zonder buffer (ffmpeg) | aan | aan | uit |
| Snelle start (eerste beeld na ~1 s i.p.v. ~3-4 s) | aan | aan | uit |
| Wachten op late pakketten (UDP) | 0 ms | 200 ms | 500 ms |
| Beeldritme | zoals ze binnenkomen | zoals ze binnenkomen | exacte fps |
| Beeldkwaliteit (2 = best … 12 = kleinst) | 5 | 5 | 3 |
| Trage kijkers | beelden overslaan | beelden overslaan | beelden bufferen |

Gemeten op een ACM-5601 bij 1280x1024: *Gebalanceerd* geeft het eerste beeld na ~1 s (was 3,6 s) en de beelden komen
gelijkmatig binnen in plaats van met schokken. *Laagste vertraging* kan kapotte beelden tonen op een druk netwerk.

### ACTi-specifiek

- **MPEG4 of MJPEG** (SETUP > ADVANCED > IN THE CAMERA > VIDEO): MPEG4 1280x1024, 8 fps, 3 Mbps komt binnen via RTSP
  (vloeiend, weinig verkeer, ffmpeg nodig). MJPEG 1280x1024, 8 fps, kwaliteit 70 komt binnen als snapshots (scherpste
  beelden, ~2 MB/s). 8 fps is het maximum bij 1280x1024 (10 bij 1280x720, 30 bij 640x480). Monitor past zijn eigen modus
  mee aan.
- **RTSP werkt niet?** Oudere ACTi-camera's draaien alleen RTSP met een "RTP"-*Streaming Method*; met de
  fabrieksinstelling *TCP Only* is poort 7070 dicht. MPEG4 toepassen zet ze op *RTP over UDP*. Deze camera's weigeren RTSP
  over TCP ("400 Bad Request"); Monitor schakelt dan zelf over op UDP.
- **Dag/nacht**: `encoder?VIDEO_DAYNIGHT_MODE=AUTO|DAY|NIGHT`, daarna `system?SAVE` (geen herstart; firmware zonder
  SAVE houdt de instelling tot de volgende herstart).
- **IP wijzigen**: ACTi-URL-commando's als de camera ze kent (`WAN_IP`, `WAN_NETMASK`, `WAN_GATEWAY`, dan *Save &
  Reboot*, ~1 min), anders ONVIF. Een camera op *Dynamic IP* valt zonder DHCP terug op `192.168.0.100`.
- **Scan**: ONVIF WS-Discovery (vindt ook camera's in andere reeksen) plus een poort-80-sweep van de eigen /24-netwerken
  van de pc (vindt ACTi-camera's zonder ONVIF).
- Pc-adressen wijzigen werkt alleen op Windows en alleen vanaf de Monitor-pc zelf (UAC-venster).
