/**
 * iOS home-screen widget via expo-widgets (WidgetKit). Requires a development/production build.
 * The app pushes the latest watchlist snapshot with updateSnapshot().
 * Widget bodies may only use @expo/ui/swift-ui components and their props (no hooks or module values).
 */
import { HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type IOSWidgetProps = { rows: { display: string; price: string; change: string; up: boolean }[]; updated: string };

const QuotesWidget = (props: IOSWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const rows = environment.widgetFamily === "systemSmall" ? props.rows.slice(0, 3) : props.rows.slice(0, 5);
  return (
    <VStack alignment="leading" spacing={4}>
      <HStack>
        <Text markdownEnabled>**RM Markets**</Text>
        <Spacer />
        <Text>{props.updated}</Text>
      </HStack>
      {rows.map((r) => (
        <HStack key={r.display}>
          <Text markdownEnabled>{`**${r.display}**`}</Text>
          <Spacer />
          <Text>{`${r.price} ${r.up ? "▲" : "▼"}${r.change}`}</Text>
        </HStack>
      ))}
    </VStack>
  );
};

export default createWidget<IOSWidgetProps>("QuotesWidget", QuotesWidget);
