export interface ConnectionEndpointDisclosure {
  endpointDomain: string | null;
  connectorOperator: null;
  dataSentTo: string | null;
}

export function getConnectionEndpointDisclosure(
  hostname: string | null,
): ConnectionEndpointDisclosure {
  return {
    endpointDomain: hostname,
    connectorOperator: null,
    dataSentTo: hostname,
  };
}
