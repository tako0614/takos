-- Delete duplicate OAuth clients for tako2, keeping only the most recently created one
DELETE FROM oauth_clients
WHERE name = 'Yurucommu (tako2)'
AND client_id != 'lgpPbKjugXXbML8ACIbfpw';
