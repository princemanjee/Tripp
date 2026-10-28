FROM alpine:3.20
RUN apk add --no-cache curl
COPY keepalive.sh /keepalive.sh
COPY crontab /etc/crontabs/root
RUN chmod +x /keepalive.sh
ENV TZ=UTC
CMD ["sh", "-c", "/keepalive.sh; exec crond -f -l 8"]
