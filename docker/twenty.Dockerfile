FROM twentycrm/twenty:v2.22.0

# Portal URL for the floating «Кабинет» button inside CRM
ARG VOXLY_CABINET_URL=http://localhost:3001/dashboard
# saas-api base URL for deal-card Telegram chat (browser → API)
ARG VOXLY_API_URL=http://localhost:3002

USER root
COPY docker/twenty-cabinet-link.js /tmp/twenty-cabinet-link.js
COPY docker/twenty-deal-chat.js /tmp/twenty-deal-chat.js
COPY docker/twenty-shell-ux.js /tmp/twenty-shell-ux.js
COPY docker/patch-twenty-functions-url.cjs /tmp/patch-twenty-functions-url.cjs
COPY docker/patch-twenty-file-base64.cjs /tmp/patch-twenty-file-base64.cjs
RUN sed -i \
  -e 's#<html lang="en"#<html lang="ru"#' \
  -e 's#<title>Twenty</title>#<title>Voxly</title>#' \
  -e 's#content="Twenty"#content="Voxly"#g' \
  /app/packages/twenty-server/dist/front/index.html \
  && sed "s|__VOXLY_CABINET_URL__|${VOXLY_CABINET_URL}|g" /tmp/twenty-cabinet-link.js \
    > /app/packages/twenty-server/dist/front/voxly-cabinet.js \
  && sed "s|__VOXLY_API_URL__|${VOXLY_API_URL}|g" /tmp/twenty-deal-chat.js \
    > /app/packages/twenty-server/dist/front/voxly-deal-chat.js \
  && cp /tmp/twenty-shell-ux.js /app/packages/twenty-server/dist/front/voxly-shell-ux.js \
  && sed -i \
    's#</body>#<script src="/voxly-cabinet.js" defer></script>\n  <script src="/voxly-deal-chat.js" defer></script>\n  <script src="/voxly-shell-ux.js" defer></script>\n  </body>#' \
    /app/packages/twenty-server/dist/front/index.html \
  && find /app/packages/twenty-server/dist/front/assets -name '*.js' -print0 \
    | xargs -0 sed -i \
      -e 's#Eee(()=>"Twenty")#Eee(()=>"Voxly")#g' \
      -e 's#default:return"Twenty"#default:return"Voxly"#g' \
      -e 's#"Twenty"#"Voxly"#g' \
  || true \
  && node /tmp/patch-twenty-functions-url.cjs \
  && node /tmp/patch-twenty-file-base64.cjs \
  && rm -f /tmp/twenty-cabinet-link.js /tmp/twenty-deal-chat.js /tmp/twenty-shell-ux.js /tmp/patch-twenty-functions-url.cjs /tmp/patch-twenty-file-base64.cjs
USER 1000
