FROM alpine:3.20
RUN apk add --no-cache curl
COPY keepalive.sh /keepalive.sh
COPY crontab /etc/crontabs/root
RUN sed -i 's/\r$//' /keepalive.sh /etc/crontabs/root && chmod +x /keepalive.sh
ENV TZ=UTC
CMD ["sh", "-c", "/keepalive.sh; exec crond -f -l 8"]
