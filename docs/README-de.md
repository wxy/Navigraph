Navigraph: Visualisieren Sie Ihren Browserverlauf
===

> Visualisieren Sie Ihre Browserpfade und Navigationsverlauf intuitiv, um Informationsflüsse besser zu verstehen und Browsingverläufe nachzuvollziehen.

## Hauptfunktionen

- 📊 **Visualisierung des Browserverlaufs** - Stellt Ihre Websurf-Trajektorien als Baumdiagramme und Beziehungsgrafiken dar
- 🗂️ **Sitzungsverwaltung** - Organisiert Browsingaktivitäten automatisch in sinnvolle Sitzungen
- 🔄 **Echtzeit-Updates** - Aktualisiert Navigationsgrafiken dynamisch während des Browsens
- 🛡️ **Datenschutz** - Alle Daten werden lokal gespeichert und nicht in die Cloud hochgeladen
- 🌙 **Dunkelmodus** - Unterstützung für dunkles Design zum Schutz Ihrer Augen

## Installationsanleitung

### Vom Chrome Web Store

1. Besuchen Sie die [Navigraph-Seite im Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Klicken Sie auf die Schaltfläche "Zu Chrome hinzufügen"

### Entwicklerinstallation

1. Klonen Sie das Repository `git clone https://github.com/wxy/Navigraph.git`
2. Installieren Sie die Abhängigkeiten `npm install`
3. Erstellen Sie die Erweiterung `npm run build`
4. Öffnen Sie den Chrome-Browser und navigieren Sie zu `chrome://extensions/`
5. Aktivieren Sie den "Entwicklermodus"
6. Klicken Sie auf "Entpackte Erweiterung laden" und wählen Sie das `dist`-Verzeichnis

## Benutzerhandbuch

Navigraph bietet eine intuitive Benutzeroberfläche, die Ihnen hilft, Ihren Browserverlauf zu visualisieren und zu analysieren. Nachfolgend finden Sie detaillierte Anweisungen:

### Grundfunktionen

1. Erweiterung starten: Klicken Sie auf das Navigraph-Symbol in Ihrer Browser-Symbolleiste, um einen neuen Tab zu öffnen, der Ihren visualisierten Browserverlauf anzeigt.
2. Aktuelle Sitzung anzeigen: Standardmäßig wird Ihre aktuelle laufende Browsersitzung angezeigt.
3. Bedienfeld: Das linke Panel bietet Funktionen zum Wechseln zwischen Sitzungen und Filtern.
4. Ansichtswechsel: Die obere Symbolleiste ermöglicht den Wechsel zwischen verschiedenen Visualisierungsansichten.

### Visualisierungsansichten

Navigraph bietet mehrere Möglichkeiten, Ihren Browserverlauf anzuzeigen:

1. Baumansicht: Zeigt Seitennavigationsbeziehungen in einer hierarchischen Struktur an und verdeutlicht, welche Seite zur nächsten geführt hat.
2. Waterfall-Ansicht: Visualisiert Browsing-Ereignisse entlang einer Zeitachse und ist nützlich, um Überlappungen und Dauer zu erkennen.

### Sitzungsverwaltung

1. Automatische Sitzungseinteilung: Das System teilt Ihren Browserverlauf basierend auf Ihren Surfgewohnheiten und Zeitintervallen automatisch in verschiedene Sitzungen ein.
2. Sitzungskalender:
   - Klicken oder bewegen Sie den Mauszeiger, um das Bedienfeld auf der rechten Seite zu öffnen
   - Daten mit Aufzeichnungen sind mit speziellen Farben markiert
   - Klicken Sie auf ein Datum, um die Sitzungen für diesen Tag anzuzeigen und den entsprechenden Browserverlauf zu laden
3. Arbeitstag-Modus: Das System organisiert Sitzungen basierend auf Arbeitstagen, um zwischen Arbeits- und Freizeitbrowsing zu unterscheiden.

### Filterung

1. Typ-Filterung: Verwenden Sie Filter-Tools, um Seiten nach Navigationstyp zu filtern (direkter Zugriff, Link-Klicks, Formularübermittlung usw.).
2. Verhaltensfilterung: Verwenden Sie Filter-Tools, um Seiten nach Navigationsverhalten zu filtern.
3. Statusfilterung: Wählen Sie, ob nur aktive Seiten angezeigt oder auch geschlossene Seiten einbezogen werden sollen.

### Knoteninteraktion

1. Details anzeigen:
   - Bewegen Sie den Mauszeiger über Knoten, um kurze Seiteninformationen anzuzeigen
   - Klicken Sie auf Knoten, um vollständige Seitendetails anzuzeigen (Titel, URL, Zugriffszeit usw.)
2. Erneut besuchen: Klicken Sie im Detailbereich des Knotens auf Links, um die Seite erneut zu öffnen
3. Knotenhervorhebung: Durch Klicken auf einen Knoten werden andere direkt verbundene Knoten hervorgehoben
4. Ziehen und Zoomen:
   - Ziehen Sie den Anzeigebereich, um die gesamte Grafik zu verschieben
   - Verwenden Sie das Mausrad zum Vergrößern oder Verkleinern
   - Verwenden Sie Zwei-Finger-Gesten auf Touch-Geräten zum Zoomen

### Personalisierung

1. Designwechsel: Wechseln Sie in der oberen Symbolleiste zwischen hellem/dunklem Design
2. Layout-Anpassung: Passen Sie Knotenabstände, Verbindungslinien-Stile und andere visuelle Parameter an
3. Sitzungseinstellungen:
   - Passen Sie die Leerlaufzeit-Schwelle für die automatische Erstellung neuer Sitzungen an
   - Wählen Sie den Sitzungsmodus (täglich/manuell/aktivitätsbasiert)

### Datenverwaltung

1. Lokale Daten: Alle Browserverlaufsdaten werden nur auf Ihrem Gerät gespeichert, um die Privatsphäre zu gewährleisten.
2. Exportfunktion: Exportieren Sie den Browserverlauf ausgewählter Sitzungen im JSON- oder CSV-Format für die Datenanalyse.

### Häufige Anwendungsfälle

1. Früher besuchte Seiten finden: Selbst wenn Sie die URL oder den Titel vergessen haben, können Sie zuvor besuchte Seiten durch die Visualisierung finden.
2. Surfgewohnheiten analysieren: Verstehen Sie Ihre Internetgewohnheiten, häufig besuchte Websites und typische Navigationspfade.
3. Arbeitsrecherche organisieren: Überprüfen Sie alle verwandten Seiten, die während bestimmter Recherche- oder Arbeitssitzungen besucht wurden, um Ideen und Materialien zu organisieren.

### Fehlerbehebung

1. Ansicht wird nicht aktualisiert: Wenn die aktuelle Browsing-Aktivität nicht im Diagramm angezeigt wird, versuchen Sie, die Erweiterungsseite zu aktualisieren.
2. Probleme bei der Sitzungserkennung: Wenn die Sitzungseinteilung nicht den Erwartungen entspricht, passen Sie den Leerlaufzeit-Schwellenwert in den Einstellungen an.

Mit dieser Anleitung sollten Sie alle Funktionen von Navigraph optimal nutzen können, um Ihren Websurf-Verlauf besser zu verwalten und zu verstehen.

## Kürzliche Änderungen

Änderungen seit v1.1.0:

- Die "Zeitleiste"-Ansicht wurde durch die neue "Waterfall"-Ansicht ersetzt.
- Anzeige der Anzahl der SPA-Anfragen als dezentes Badge in der Baumansicht.
- Neugestaltung der Sitzungswurzel: Kreisförmiges Element mit zweizeiliger Datumsanzeige.

## Technische Architektur

Navigraph ist mit einer modernen Browser-Erweiterungsarchitektur konzipiert:

- **Frontend**: TypeScript, D3.js, CSS3
- **Speicher**: IndexedDB, LocalStorage
- **Browser-API**: Chrome Extensions API
- **Build-Tools**: Webpack

## Mitwirkung

Wir begrüßen alle Arten von Beiträgen! Wenn Sie an diesem Projekt teilnehmen möchten:

1. Forken Sie dieses Repository
2. Erstellen Sie Ihren Feature-Branch (`git checkout -b feature/amazing-feature`)
3. Übertragen Sie Ihre Änderungen (`git commit -m 'Add some amazing feature'`)
4. Pushen Sie zum Branch (`git push origin feature/amazing-feature`)
5. Öffnen Sie einen Pull Request

## Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe die Datei [LICENSE](LICENSE) für Details

## Kontakt

Falls Sie Fragen oder Anregungen haben, kontaktieren Sie uns bitte über:

- Ein Issue einreichen: [GitHub Issues](https://github.com/wxy/Navigraph/issues)