Navigraph : Visualisation de l'historique de navigation
===

> Visualisez intuitivement vos chemins de navigation et l'historique de navigation web pour comprendre le flux d'informations et vous aider à vous souvenir de vos itinéraires de navigation.

## Fonctionnalités principales

- 📊 **Visualisation de l'historique de navigation** - Affichez les chemins de navigation web à l'aide de diagrammes en arbre et en cascade
- 🗂️ **Gestion des sessions** - Organisez automatiquement les activités de navigation en sessions significatives
- 🔄 **Mises à jour en temps réel** - Mettez à jour dynamiquement les diagrammes de navigation pendant la navigation
- 🛡️ **Protection de la vie privée** - L’historique de navigation reste dans le profil local du navigateur ; les préférences peuvent être synchronisées via le compte du navigateur
- 🌙 **Mode sombre** - Prend en charge les thèmes sombres pour protéger vos yeux

### Démarrage rapide

1. Ouvrez la page de l'extension (cliquez sur l'icône Navigraph dans la barre d'outils).
2. Survolez brièvement ou cliquez sur la poignée du panneau de contrôle sur le côté droit de la page pour ouvrir la barre latérale. Depuis la barre latérale, vous pouvez sélectionner des dates de session, changer de vue ou filtrer les nœuds.
3. Utilisez la barre d'état pour changer de vue ou basculer la visibilité des nœuds masqués/fermés.
4. Cliquez sur les nœuds pour afficher des informations détaillées.

## Guide de l'utilisateur (aperçu)

### Installation

#### Depuis le Chrome Web Store

1. Visitez la [page Navigraph sur le Chrome Web Store](https://chrome.google.com/webstore/detail/navigraph/jfjgdldpgmnhclffkkcnbhleijeopkhi)
2. Cliquez sur "Ajouter à Chrome"

#### Depuis le Microsoft Edge Add-ons Store

1. Visitez la [page Navigraph sur le Microsoft Edge Add-ons Store](https://microsoftedge.microsoft.com/addons/detail/ibcpeknflplfaljendadfkhmflhfnhdh)
2. Cliquez sur "Obtenir" pour installer l'extension

### Barre latérale

La barre latérale est principalement utilisée pour la sélection de sessions et le filtrage des nœuds :

- Changement de vue : Changez la vue actuelle (diagramme en arbre / diagramme en cascade) depuis le haut de la barre latérale
- Calendrier des sessions : Affiche les sessions par date et vous permet de sélectionner et de charger des historiques de sessions. Si plusieurs sessions existent le même jour, elles sont affichées individuellement
- Contrôles de filtrage : Filtrez les résultats en fonction des types de navigation ou des actions (par exemple, afficher uniquement les clics sur les liens, les soumissions de formulaires, etc.)

Astuce : La barre latérale sert de point d'entrée principal pour changer les plages de données ou identifier les portées d'analyse. Il est recommandé de sélectionner d'abord une session, puis de changer de vue.

### Barre d'état

La barre d'état fournit un contexte concis et des interactions dans l'interface :

- Affiche et change la vue actuelle (diagramme en arbre / diagramme en cascade)
- Affiche les statistiques de session (par exemple, nombre de nœuds, durée de la session) et fournit des actions rapides liées à la vue (par exemple, basculer la visibilité des nœuds masqués)
- Cliquez sur la date pour revenir rapidement à la session d'aujourd'hui

Explication : Les contrôles de la barre d'état sont des points d'entrée d'interaction directe liés à la vue actuelle. Un filtrage plus complexe continue d'être effectué via la barre latérale.

### Interactions avec les vues

Navigraph propose deux vues complémentaires : le diagramme en arbre et le diagramme en cascade.

#### Diagramme en arbre

Objectif : Affichez les chemins de navigation des pages à l'aide de relations hiérarchiques, ce qui facilite l'analyse des points d'entrée et des branches.

- Interaction avec les nœuds : Survolez pour afficher des informations brèves. Cliquez pour ouvrir le panneau de détails (y compris le titre, l'URL, l'heure d'accès, le nombre de requêtes SPA, etc.)
- Zoom/Déplacement : Dans la vue en arbre, faites glisser la toile avec la souris pour la déplacer, et utilisez la molette de la souris pour mettre à l'échelle la vue (le comportement spécifique peut varier selon le navigateur et les paramètres)
- Badge SPA : Les nœuds de l'arbre comportent des badges annulaires subtils et des chiffres (si des requêtes SPA existent) pour indiquer le nombre de requêtes SPA fusionnées dans le nœud.

#### Diagramme en cascade

Objectif : Affichez les événements/requêtes le long d'une chronologie, ce qui facilite l'identification des chevauchements et des durées.

- Interaction avec les nœuds : Dans le diagramme en cascade, les nœuds dans le même onglet et la même plage de temps sont regroupés en groupes repliables. Les utilisateurs peuvent développer ces groupes pour voir les éléments à l'intérieur. Les groupes repliables sont généralement affichés dans un style tiroir et prennent en charge le défilement interne
- Groupes repliables : Groupés par onglet (les nœuds dans le même onglet et la même plage de temps sont fusionnés dans le même groupe). Après expansion, plus d'éléments peuvent être défilés dans le tiroir
- Molette et Déplacement : Dans l'implémentation actuelle, la molette de la souris est principalement utilisée pour faire défiler verticalement entre les voies. Le déplacement est utilisé pour déplacer la fenêtre temporelle ou ajuster la position de la fenêtre d'observation
- Badge SPA : La marque dans le coin supérieur droit des nœuds indique le nombre de requêtes SPA fusionnées dans le nœud.

### Page des options (paramètres)

La page des options comprend plusieurs préférences pour ajuster le comportement de l'extension :

- Seuil de temps d'inactivité pour la division des sessions (utilisé pour diviser automatiquement les sessions)
- Sélection du mode de session (par exemple, quotidien / manuel / basé sur l'activité)
- Sélection de la langue (utilisée pour forcer la langue de localisation de l'interface)

Explication : Le filtrage des nœuds, le contrôle de la visibilité et des opérations de filtrage plus détaillées sont fournis par les contrôles de filtrage dans la barre latérale ou les contrôles dans la vue. La page des options se concentre sur le comportement global et les paramètres de localisation.

### Dépannage (FAQ)

- La vue ne se met pas à jour : Actualisez la page de l'extension ou essayez de recharger la session.
- Problèmes de division des sessions : Ajustez le seuil de temps d'inactivité dans la page des options pour obtenir une division plus conforme aux attentes.

## Gestion des données et confidentialité

- Stockage local : Toutes les données d'historique de navigation sont stockées localement (IndexedDB / LocalStorage) et ne sont jamais téléchargées sur le cloud.

## Dernières mises à jour

Modifications majeures depuis la v1.1.0 :

- Suppression de la vue "Chronologie" et ajout d'une nouvelle vue "Cascade". Affiche les événements et les affectations de voies le long d'une chronologie
- Ajout de la gestion des requêtes de pages SPA au diagramme en arbre : Affiche le nombre de requêtes SPA dans les détails des nœuds et comporte de petits badges annulaires sur les nœuds pour indiquer la présence de requêtes SPA

## Informations pour les développeurs et techniques

### Développement local et construction

1. Clonez le dépôt : `git clone https://github.com/wxy/Navigraph.git`
2. Installez les dépendances : `npm install`
3. Construisez : `npm run build`
4. Chargez l'extension non empaquetée dans Chrome (`chrome://extensions/`) et sélectionnez le répertoire `dist`

### Problèmes et contact

Soumettez des bugs ou des demandes de fonctionnalités sur GitHub Issues : https://github.com/wxy/Navigraph/issues

### Directives de contribution

Si vous souhaitez contribuer :

1. Forkez le dépôt et créez une branche de fonctionnalité (`git checkout -b feature/your-feature`)
2. Commitez des modifications claires et ouvrez une pull request (PR)

Si vous trouvez des erreurs ou des inexactitudes dans les langues utilisées par cette extension, soumettez une pull request incluant des améliorations de traduction !

### Licence

Ce projet est sous licence MIT — voir [LICENSE](LICENSE) pour les détails.

### Stack technique

- Frontend : TypeScript, D3.js, CSS3
- Stockage : IndexedDB / LocalStorage
- API du navigateur : API des extensions Chrome
- Outil de construction : Webpack