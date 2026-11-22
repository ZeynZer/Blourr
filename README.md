# Blourr

PWA familiale : galerie photos/vidéos/fichiers partagée + espace ciné (films, séries, sagas, reprise de lecture).

- Front : HTML/CSS/JS sans build, hébergé sur GitHub Pages
- Comptes et données : Supabase (`supabase/schema.sql`, fonctions dans `supabase/functions`)
- Fichiers : Cloudflare R2 (envoi direct depuis le navigateur via des URLs signées)

Les clés R2 ne sont jamais dans ce dépôt : elles se saisissent dans l'appli (Profil → Stockage, admin uniquement).
