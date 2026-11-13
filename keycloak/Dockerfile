# Keycloak com o tema de login do IAORG embutido na imagem.
# Antes o tema vinha de uma pasta montada do projeto; se o Docker subisse antes do WSL liberar a pasta,
# ela chegava vazia e o login caía no visual padrão. Embutido, o tema sempre está lá.
# Depois de mudar o tema: docker compose up -d --build keycloak
FROM quay.io/keycloak/keycloak:26.4.7
COPY --chown=keycloak:root themes/iaorg /opt/keycloak/themes/iaorg
