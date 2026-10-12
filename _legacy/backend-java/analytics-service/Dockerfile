FROM eclipse-temurin:17-jdk
WORKDIR /app
COPY target/analytics-service-0.0.1-SNAPSHOT.jar /app/analytics-service.jar
EXPOSE 8084
ENTRYPOINT ["java", "-jar", "/app/analytics-service.jar"]
