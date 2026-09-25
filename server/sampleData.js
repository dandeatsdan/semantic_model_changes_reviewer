export const sampleModels = {
  reference: {
    name: 'Sample Sales — Reference',
    files: [
      {
        path: 'Sample.Reference.SemanticModel/definition/model.tmdl',
        content: `model Model
    compatibilityLevel: 1601
`
      },
      {
        path: 'Sample.Reference.SemanticModel/definition/tables/Date.tmdl',
        content: `table Date
    column Date
        dataType: dateTime
        sourceColumn: Date
        formatString: "dd mmm yyyy"
        summarizeBy: none
`
      },
      {
        path: 'Sample.Reference.SemanticModel/definition/tables/Sales.tmdl',
        content: `table Sales
    column 'Order ID'
        dataType: int64
        sourceColumn: OrderID
        summarizeBy: none

    column Amount
        dataType: decimal
        sourceColumn: Amount
        formatString: "£#,0.00"
        summarizeBy: sum

    column Discount
        dataType: decimal
        sourceColumn: Discount
        formatString: "£#,0.00"
        summarizeBy: sum

    measure 'Total Sales' = SUM(Sales[Amount])
        formatString: "£#,0.00"
        displayFolder: Core

    measure 'Net Sales' = [Total Sales] - SUM(Sales[Discount])
        formatString: "£#,0.00"
        displayFolder: Core

    measure 'Legacy Margin' = [Net Sales] * 0.10
        formatString: "£#,0.00"
`
      }
    ]
  },
  candidate: {
    name: 'Sample Sales — Candidate',
    files: [
      {
        path: 'Sample.Candidate.SemanticModel/definition/model.tmdl',
        content: `model Model
    compatibilityLevel: 1601
`
      },
      {
        path: 'Sample.Candidate.SemanticModel/definition/tables/Date.tmdl',
        content: `table Date
    column Date
        dataType: dateTime
        sourceColumn: Date
        formatString: "dd mmm yyyy"
        summarizeBy: none
`
      },
      {
        path: 'Sample.Candidate.SemanticModel/definition/tables/Sales.tmdl',
        content: `table Sales
    column 'Order ID'
        dataType: int64
        sourceColumn: OrderID
        summarizeBy: none

    column Amount
        dataType: decimal
        sourceColumn: Amount
        formatString: "£#,0.0"
        summarizeBy: sum

    column Discount
        dataType: decimal
        sourceColumn: Discount
        formatString: "£#,0.00"
        summarizeBy: sum

    column Region
        dataType: string
        sourceColumn: Region
        summarizeBy: none

    measure 'Total Sales' = SUM(Sales[Amount])
        formatString: "£#,0.00"
        displayFolder: Core

    measure 'Net Sales' = [Total Sales] - SUM(Sales[Discount]) - [Returns]
        formatString: "£#,0.00"
        displayFolder: Core

    measure Returns = SUM(Sales[Discount]) * 0.25
        formatString: "£#,0.00"
        displayFolder: Adjustments
`
      }
    ]
  }
}
