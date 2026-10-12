FROM eclipse-temurin:17-jdk
WORKDIR /app
COPY target/trading-service-0.0.1-SNAPSHOT.jar /app/trading-service.jar
EXPOSE 8083
ENTRYPOINT ["java", "-jar", "/app/trading-service.jar"]
