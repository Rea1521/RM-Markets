FROM eclipse-temurin:17-jdk
WORKDIR /app
COPY target/market-service-0.0.1-SNAPSHOT.jar /app/market-service.jar
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/market-service.jar"]
