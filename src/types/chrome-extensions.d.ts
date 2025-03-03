declare namespace chrome {
  namespace webNavigation {
    interface WebNavigationFramedCallbackDetails {
      transitionQualifiers?: string[];
      transitionType?: string;
    }
  }
}