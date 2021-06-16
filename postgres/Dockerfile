FROM alpine
RUN apk --no-cache add postgresql py-pip ca-certificates && pip install s3cmd
COPY backup.sh backup.sh
ENTRYPOINT ["./backup.sh"]
