Navigraph : Visualisez votre historique de navigation
===

> Visualisez intuitivement vos parcours de navigation et votre historique Web, vous aidant à comprendre le flux d'information et à mémoriser vos trajectoires de navigation.

## Fonctionnalités principales

- 📊 **Visualisation de l'historique** - Affichez vos parcours Web sous forme de diagrammes arborescents et de graphes relationnels
- 🗂️ **Gestion des sessions** - Organisation automatique des activités de navigation en sessions significatives
- 🔄 **Mises à jour en temps réel** - Actualisation dynamique des graphiques pendant votre navigation
- 🛡️ **Protection de la vie privée** - Toutes les données sont stockées localement, jamais téléchargées vers le cloud
- 🌙 **Mode sombre** - Support du thème sombre pour protéger vos yeux

## Installation

### Depuis le Chrome Web Store

1. Visitez la [page Navigraph sur le Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Cliquez sur le bouton "Ajouter à Chrome"

### Installation pour développeurs

1. Téléchargez ce dépôt `git clone https://github.com/wxy/Navigraph.git`
2. Installez les dépendances `npm install`
3. Construisez l'extension `npm run build`
4. Dans le navigateur Chrome, ouvrez `chrome://extensions/`
5. Activez le "Mode développeur"
6. Cliquez sur "Charger l'extension non empaquetée" et sélectionnez le répertoire `dist`

## Guide d'utilisation

Navigraph offre une interface intuitive qui vous aide à visualiser et analyser votre historique de navigation. Voici des instructions détaillées :

### Opérations de base

1. Lancer l'extension : Cliquez sur l'icône Navigraph dans la barre d'outils de votre navigateur pour ouvrir un nouvel onglet affichant la visualisation de votre historique.
2. Voir la session actuelle : Par défaut, l'extension affiche votre session de navigation en cours.
3. Panneau de contrôle : Le panneau gauche permet de changer de session et d'appliquer des filtres.
4. Changement de vue : La barre d'outils supérieure permet de basculer entre différentes vues de visualisation.

### Vues de visualisation

Navigraph propose plusieurs façons de consulter votre historique de navigation :

1. Vue arborescente : Affiche les relations de navigation entre pages dans une structure hiérarchique, montrant clairement quelle page a mené à la suivante.
2. Chronologie : Présente votre historique de navigation de façon chronologique, facilitant la compréhension de la distribution temporelle.

### Gestion des sessions

1. Division automatique des sessions : Le système divise automatiquement votre historique de navigation en différentes sessions selon vos habitudes et intervalles de temps.
2. Calendrier des sessions :
   - Cliquez ou survolez avec la souris pour ouvrir le panneau de contrôle à droite
   - Les dates avec des enregistrements sont marquées de couleurs spéciales
   - Cliquez sur une date pour voir les sessions de ce jour et charger son historique de navigation
3. Mode jour ouvrable : Le système organise les sessions en fonction des jours ouvrables, facilitant la distinction entre activités de navigation professionnelles et personnelles.

### Filtrage

1. Filtrage par type : Utilisez les outils de filtrage pour filtrer les pages par type de navigation (accès direct, clics sur liens, soumissions de formulaires, etc.).
2. Filtrage par comportement : Utilisez les outils de filtrage pour filtrer les pages par comportement de navigation.
3. Filtrage par statut : Choisissez d'afficher uniquement les pages actives ou d'inclure les pages fermées.

### Interaction avec les nœuds

1. Voir les détails :
   - Survolez les nœuds pour afficher de brèves informations sur la page
   - Cliquez sur les nœuds pour voir les détails complets (titre, URL, heure d'accès, etc.)
2. Revisiter : Cliquez sur les liens dans le panneau de détails du nœud pour rouvrir la page
3. Mise en évidence : Cliquer sur un nœud met en évidence les autres nœuds directement liés
4. Déplacement et zoom :
   - Faites glisser la zone de visualisation pour déplacer l'ensemble du graphique
   - Utilisez la molette de la souris pour zoomer ou dézoomer
   - Utilisez les gestes à deux doigts sur les appareils tactiles pour zoomer

### Personnalisation

1. Changement de thème : Basculez entre les thèmes clair/sombre dans la barre d'outils supérieure
2. Ajustement de la mise en page : Ajustez l'espacement des nœuds, le style des lignes de connexion et autres paramètres visuels
3. Paramètres de session :
   - Ajustez le seuil de temps d'inactivité pour la création automatique de nouvelles sessions
   - Sélectionnez le mode de session (quotidien/manuel/basé sur l'activité)

### Gestion des données

1. Localisation des données : Toutes les données d'historique sont stockées uniquement sur votre appareil, garantissant la confidentialité.
2. Fonctionnalité d'exportation : Exportez l'historique de navigation des sessions sélectionnées aux formats JSON ou CSV pour analyse.

### Cas d'utilisation courants

1. Retrouver des pages visitées précédemment : Même si vous avez oublié l'URL ou le titre, vous pouvez retrouver les pages précédemment consultées grâce à la visualisation.
2. Analyser les habitudes de navigation : Comprendre vos habitudes Internet, les sites fréquemment visités et les parcours de navigation typiques.
3. Organisation de la recherche professionnelle : Revisitez toutes les pages connexes consultées lors de sessions spécifiques pour organiser vos idées et matériaux.

### Dépannage

1. Vue non mise à jour : Si l'activité de navigation actuelle n'apparaît pas dans le graphique, essayez d'actualiser la page de l'extension.
2. Problèmes d'identification de session : Si la division des sessions ne correspond pas à vos attentes, ajustez le seuil de temps d'inactivité dans les paramètres.

Avec ce guide, vous devriez être en mesure de profiter pleinement de toutes les fonctionnalités de Navigraph pour mieux gérer et comprendre votre historique de navigation Web.

## Architecture technique

Navigraph est conçu avec une architecture moderne d'extension de navigateur :

- **Frontend** : TypeScript, D3.js, CSS3
- **Stockage** : IndexedDB, LocalStorage
- **API navigateur** : Chrome Extensions API
- **Outils de build** : Webpack

## Contribution

Nous accueillons toutes formes de contributions ! Si vous souhaitez participer à ce projet :

1. Forkez ce dépôt
2. Créez votre branche de fonctionnalité (`git checkout -b feature/amazing-feature`)
3. Validez vos modifications (`git commit -m 'Add some amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails

## Contact

Si vous avez des questions ou des suggestions, veuillez nous contacter via :

- Soumettre un problème : [GitHub Issues](https://github.com/wxy/Navigraph/issues)