FROM eclipse-temurin:17-jdk
WORKDIR /app
COPY target/news-service-0.0.1-SNAPSHOT.jar /app/news-service.jar
EXPOSE 8085
ENTRYPOINT ["java", "-jar", "/app/news-service.jar"]
